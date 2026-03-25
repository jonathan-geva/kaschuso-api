#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
    const args = {
        baseUrl: 'https://portal.sbl.ch/',
        mandator: 'gymli',
        username: process.env.SAL_TRACE_USERNAME || '',
        password: process.env.SAL_TRACE_PASSWORD || '',
        includeRewritten: process.env.SAL_TRACE_REWRITTEN === 'true'
    };

    for (let i = 2; i < argv.length; i++) {
        const current = argv[i];
        const next = argv[i + 1];
        if (current === '--base-url' && next) {
            args.baseUrl = next;
            i++;
        } else if (current === '--mandator' && next) {
            args.mandator = next;
            i++;
        } else if (current === '--username' && next) {
            args.username = next;
            i++;
        } else if (current === '--password' && next) {
            args.password = next;
            i++;
        } else if (current === '--include-rewritten') {
            args.includeRewritten = true;
        }
    }

    return args;
}

function fail(message) {
    console.error(message);
    process.exit(1);
}

function runCurl(args) {
    const fullArgs = ['--connect-timeout', '8', '--max-time', '20'].concat(args);
    return spawnSync('curl', fullArgs, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
}

function parseCookieJar(cookieJarPath) {
    if (!fs.existsSync(cookieJarPath)) {
        return [];
    }

    const raw = fs.readFileSync(cookieJarPath, 'utf8');
    return raw
        .split(/\r?\n/)
        .filter(Boolean)
        .filter(line => !line.startsWith('#') || line.startsWith('#HttpOnly_'))
        .map(line => line.startsWith('#HttpOnly_') ? line.slice('#HttpOnly_'.length) : line)
        .map(line => line.split(/\t+/))
        .filter(parts => parts.length >= 7)
        .map(parts => ({
            domain: parts[0],
            path: parts[2],
            name: parts[5],
            valueLength: (parts[6] || '').length
        }));
}

function snapshotCookies(cookieJarPath) {
    return parseCookieJar(cookieJarPath)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(cookie => `${cookie.domain}|${cookie.path}|${cookie.name}|len=${cookie.valueLength}`);
}

function summarizeBody(body) {
    const html = String(body || '');
    const pageTypeMatch = html.match(/"pageType"\s*:\s*"([^"]+)"/i);
    return {
        hasPageLinks: /index\.php\?pageid=\d+/i.test(html),
        hasAcl17: /"errorcode"\s*:\s*17/i.test(html) && /my\.acl/i.test(html),
        hasLoginCta: /href="https:\/\/portal\.sbl\.ch\/gymli\/index\.php"/i.test(html),
        hasPolicyLogon: /"pageType"\s*:\s*"logon"/i.test(html),
        pageType: pageTypeMatch ? pageTypeMatch[1] : null,
        preview: html.replace(/\s+/g, ' ').slice(0, 220)
    };
}

function executeStep(name, url, cookieJarPath, opts) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sal-trace-step-'));
    const bodyPath = path.join(tempDir, 'body.txt');
    const headersPath = path.join(tempDir, 'headers.txt');

    const args = ['-sS', '-L', '-b', cookieJarPath, '-c', cookieJarPath, '-D', headersPath, '-o', bodyPath];
    if (opts && opts.referer) {
        args.push('-e', opts.referer);
    }
    if (opts && opts.postData) {
        args.push('-H', 'Content-Type: application/x-www-form-urlencoded');
        args.push('--data-urlencode', `username=${opts.postData.username}`);
        args.push('--data-urlencode', `password=${opts.postData.password}`);
    }
    args.push(url);

    const result = runCurl(args);
    const body = fs.existsSync(bodyPath) ? fs.readFileSync(bodyPath, 'utf8') : '';
    const headers = fs.existsSync(headersPath) ? fs.readFileSync(headersPath, 'utf8') : '';

    const statusMatch = headers.match(/HTTP\/[0-9.]+\s+(\d{3})/g);
    const statuses = statusMatch ? statusMatch.map(line => line.match(/(\d{3})$/)[1]) : [];
    const locationMatches = Array.from(headers.matchAll(/^Location:\s*(.+)$/gim)).map(match => match[1].trim());

    const summary = {
        name,
        url,
        ok: result.status === 0,
        exitCode: result.status,
        stderr: (result.stderr || '').trim() || null,
        statuses,
        locations: locationMatches,
        body: summarizeBody(body),
        cookieSnapshot: snapshotCookies(cookieJarPath)
    };

    fs.rmSync(tempDir, { recursive: true, force: true });
    return summary;
}

function buildUrls(baseUrl, mandator, includeRewritten) {
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const origin = new URL(normalizedBase).origin;
    const originHex = Buffer.from(origin, 'utf8').toString('hex');
    const rewrittenBase = `${normalizedBase}f5-w-${originHex}$$/${mandator}/`;

    const urls = [
        { name: 'hangup', url: `${normalizedBase}vdesk/hangup.php3` },
        { name: 'policy_get', url: `${normalizedBase}my.policy` },
        { name: 'policy_post', url: `${normalizedBase}my.policy`, isPost: true },
        { name: 'webtop', url: `${normalizedBase}vdesk/webtop.eui?webtop=/Common/schulportal_wt&webtop_type=webtop_full` },
        { name: 'resource_list', url: `${normalizedBase}vdesk/resource_list.xml?resourcetype=res` },
        { name: 'direct_home', url: `${normalizedBase}${mandator}/` },
        { name: 'direct_index', url: `${normalizedBase}${mandator}/index.php` },
        { name: 'direct_page_21311', url: `${normalizedBase}${mandator}/index.php?pageid=21311` },
        { name: 'direct_page_21111', url: `${normalizedBase}${mandator}/index.php?pageid=21111` },
        { name: 'direct_page_22500', url: `${normalizedBase}${mandator}/index.php?pageid=22500` }
    ];

    if (includeRewritten) {
        urls.splice(6, 0,
            { name: 'rewritten_home', url: rewrittenBase },
            { name: 'rewritten_index', url: `${rewrittenBase}index.php` },
            { name: 'rewritten_page_21311', url: `${rewrittenBase}index.php?pageid=21311` }
        );
    }

    return urls;
}

function main() {
    const args = parseArgs(process.argv);
    if (!args.username || !args.password) {
        fail('Missing credentials. Provide --username and --password or SAL_TRACE_USERNAME/SAL_TRACE_PASSWORD.');
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sal-trace-'));
    const cookieJarPath = path.join(tempDir, 'cookies.txt');
    const urls = buildUrls(args.baseUrl, args.mandator, args.includeRewritten);
    const results = [];

    try {
        for (const step of urls) {
            const summary = executeStep(step.name, step.url, cookieJarPath, {
                referer: `${args.baseUrl.replace(/\/$/, '')}/vdesk/webtop.eui?webtop=/Common/schulportal_wt&webtop_type=webtop_full`,
                postData: step.isPost ? { username: args.username, password: args.password } : null
            });
            results.push(summary);
        }

        const output = {
            timestamp: new Date().toISOString(),
            baseUrl: args.baseUrl,
            mandator: args.mandator,
            includeRewritten: args.includeRewritten,
            steps: results
        };

        console.log(JSON.stringify(output, null, 2));
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

main();
