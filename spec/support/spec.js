'use strict';

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const http = require('http'),
    { Client } = require('pg'),
    { fork } = require('child_process');

let server;

describe('server', () => {
    beforeAll(async () => {
        const client = new Client({ connectionString: process.env.DATABASE_URL });
        await client.connect();
        await client.query(`
            DROP DATABASE IF EXISTS ${process.env.TEST_DATABASE_NAME}`);
        await client.query(`
            CREATE DATABASE ${process.env.TEST_DATABASE_NAME}
            TEMPLATE ${process.env.TEMPLATE_DATABASE_NAME}`);
        await client.end();

        server = fork('server.js', {
            stdio: 'pipe',
            env: { DATABASE_URL: process.env.TEST_DATABASE_URL }
        });
        server.stderr.pipe(process.stderr);
        server.stdout.pipe(process.stdout);

        process.on('exit', () => server.kill());
    });

    it('should say it started', done => {
        server.stdout.on('data', data => {
            expect(String(data))
                .toBe(`Server running at port ${process.env.PORT || 80}\n`);
            done();
        });
    });

    it('should give status 200 on GET /', async () => {
        expect((await get('/')).statusCode).toBe(200);
    });

    it('should give status 404 on GET /noexist', async () => {
        expect((await get('/noexist')).statusCode).toBe(404);
    });
});

function get(url, cookie) {
    return request('GET', url, cookie);
}

function post(url, body, cookie) {
    return request('POST', url, cookie, body);
}

function request(method, url, cookie, body) {
    return new Promise(resolve => {
        const req = http.request({
            hostname: 'localhost',
            port: process.env.PORT,
            path: url,
            method,
            headers: {'x-forwarded-proto': 'https', cookie }
        }, resolve);
        if (body) req.write(body);
        req.end();
    });
}