'use strict';

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const http = require('http'),
    { Client } = require('pg'),
    { fork } = require('child_process'),
    { parse } = require('cookie'),
    colors = require('colors/safe');

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
        server.stderr.on('data',
            data => process.stderr.write(colors.bold.red(String(data))));
        server.stdout.on('data',
            data => process.stdout.write(colors.bold.blue(String(data))));

        process.on('exit', () => server.kill());
    });

    it("should say it started", done => {
        server.stdout.on('data', data => {
            expect(String(data))
                .toBe(`Server running at port ${process.env.PORT || 80}\n`);
            done();
        });
    });

    it("should give status 200 on GET /", async () => {
        expect((await get('/')).statusCode).toBe(200);
    });

    it("should give status 404 on GET /noexist", async () => {
        expect((await get('/noexist')).statusCode).toBe(404);
    });

    let user1, user2;

    it("should let you create an account", async () => {
        expect(parse(user1 =
            (await post('/signup', 'username=user&password=super_secret&url='))
            .headers['set-cookie'][0]).token).toBeDefined();
    });

    it("should let you sign in", async () => {
        expect(parse(
            (await post('/signin', 'username=user&password=super_secret&url='))
            .headers['set-cookie'][0]).token).toBeDefined();
        expect(
            (await post('/signin', 'username=user&password=wrong_password'))
            .headers['set-cookie']).not.toBeDefined();
    });

    it("should let you go to /new if and only if you are signed in", async () => {
        expect((await get('/new')).statusCode).toBe(401);
        expect((await get('/new', user1)).statusCode).toBe(200);
    });

    it("should let you create a game", async () => {
        expect((await post('/create', 'name=game')).statusCode).toBe(401);
        expect((await post('/create', 'name=game', user1)).statusCode).toBe(200);
    });

    it("should'nt let two accounts have the same username", async () => {
        expect(await response(await get('/check/username?name=user'))).toBe('1');
        expect(await response(await get('/check/username?name=not_taken'))).toBe('0');
        expect((await post('/signup', 'username=user&password=pass&url=')).statusCode).toBe(400);
    });
});

function get(url, cookie) {
    return request('GET', url, cookie);
}

function post(url, body, cookie) {
    return request('POST', url, cookie, body);
}

const request = (method, url, cookie, body) => new Promise(resolve => {
    const headers = {'x-forwarded-proto': 'https'};
    if (cookie) headers.cookie = cookie;
    const req = http.request({
        hostname: 'localhost',
        port: process.env.PORT,
        path: url,
        method,
        headers
    }, resolve);
    if (body) req.write(body);
    req.end();
});

const response = req => new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
    req.on('error', reject);
});