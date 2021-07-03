'use strict';

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const http = require('http'),
    { Client } = require('pg'),
    { fork } = require('child_process'),
    { parse } = require('cookie'),
    { JSDOM } = require('jsdom'),
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
            data => process.stderr.write(colors.bold.red(`\n${data}`)));
        server.stdout.on('data',
            data => process.stdout.write(colors.bold.blue(`\n${data}`)));

        process.on('exit', () => server.kill());
    });

    it("should say it started", done => {
        let said_it = false;
        server.stdout.on('data', data => {
            if (!said_it) {
                expect(String(data))
                    .toBe(`Server running at port ${process.env.PORT || 80}\n`);
                done();
                said_it = true;
            }
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

    let game_id;

    it("should let you create a game", async () => {
        expect((await post('/create', 'name=game')).statusCode).toBe(401);
        const req = await post('/create', 'name=game', user1);
        expect(req.statusCode).toBe(200);
        game_id = await response(req);
    });

    it("should'nt let two accounts have the same username", async () => {
        expect(await response(await get('/check/username?name=user'))).toBe('1');
        expect(await response(await get('/check/username?name=not_taken'))).toBe('0');
        expect((await post('/signup', 'username=user&password=pass&url=')).statusCode).toBe(400);
    });

    it("should let you edit the game", async () => {
        expect((await get(`/edit?game=${game_id}`, user1)).statusCode).toBe(200);
    });

    let location_id;
    it("should let you add a location", async () => {
        location_id = await add(`type=location&name=place`);
    });

    it("should let you make the location start", async () => {
        expect((await post('/setstart', `game=${game_id}&id=${location_id}`, user1)).statusCode).toBe(204);
    });

    it("should let you start the game", async () => {
        expect((await get(`/start?game=${game_id}`, user1)).statusCode).toBe(200);
    });

    it("should let you change the start text", async () => {
        const text = "You are in a test game.\nThere are two lines of text."
        expect((await post('/change/start-text',
            `game=${game_id}&text=${encodeURIComponent(text)}`, user1)).statusCode).toBe(204);
        expect((await document(`/start?game=${game_id}`)).querySelector('p').innerHTML)
            .toBe(text.replace(/\n/, '<br>'));
    });

    let object_id;
    it("should let you add an object", async () => {
        object_id = await add(`type=object&name=thing&location=${location_id}`);
        expect(await response(await get(`/all-objects?game=${game_id}`, user1))).toEqual([{
            id: object_id,
            name: 'thing',
            loc_id: location_id,
            loc_name: 'place'
        }]);
    });

    let grab_id;
    it("should let you add a pick up action", async () => {
        grab_id = await add(`type=grab&item=${object_id}`, user1);
    });
    
    let start_game_state, have_thing_game_state;
    it("should let you pick up the object", async () => {
        start_game_state = state(await document(`/start?game=${game_id}`));
        const doc = await document(`/play?gameState=${start_game_state}&cmd=pick+up+thing`);
        have_thing_game_state = state(doc);
        const [, text, inventory] = doc.querySelectorAll('p');
        expect(text.textContent).toBe('You have a thing.');
        expect(inventory.textContent).toBe('You have: thing');
    });

    it("should let you disable picking up the object", async () => {
        expect((await post('/change/item',
            `type=grab&id=${grab_id}&state=false&game=${game_id}`, user1)).statusCode).toBe(204);
        const [, text, inventory] =
            (await document(`/play?gameState=${start_game_state}&cmd=pick+up+thing`))
            .querySelectorAll('p');
        expect(text.textContent).toBe('Nothing happens.');
        expect(inventory.textContent).toBe('');
    });

    let obj2_id;
    it("should let you rename an object", async () => {
        obj2_id = await add(`type=object&name=bad+name&location=${location_id}`);
        expect((await post('/rename',
            `type=object&name=other+thing&id=${obj2_id}&game=${game_id}`, user1))
            .statusCode).toBe(204);
        const [, { name }] = await response(await get(`/all-objects?game=${game_id}`, user1));
        expect(name).toBe('other thing');
    });

    let action_id;
    it("should let you add an action", async () => {
        action_id = await add(`type=action&item=${object_id}`);
    });

    it("should let you add text to an action", async () => {
        expect((await post('/change/description',
            `type=action&id=${action_id}&text=Something+happens!&game=${game_id}`, user1)).statusCode).toBe(204);
    });

    it("should let you do an action on an object in your location", async () => {
        expect((await document(`/play?cmd=use+thing&gameState=${start_game_state}`))
            .querySelector('p:nth-of-type(2)').textContent).toBe('Something happens!');
    });

    const description_ids = [];
    it("should let you add text to a location", async () => {
        const add_description = num => add(`type=description&item=${location_id}&num=${num}`);
        description_ids[1] = await add_description(0);
        description_ids[0] = await add_description(0);
        description_ids[2] = await add_description(2);
        const add_text = async (index, text) => expect((await post('/change/description',
            `type=location&id=${description_ids[index]}&text=${text}&game=${game_id}`,
            user1)).statusCode).toBe(204);
        await Promise.all([
            add_text(0, 'first part, '),
            add_text(1, 'second part, '),
            add_text(2, 'third part.')]);
        expect((await document(`/start?game=${game_id}`))
            .querySelector('p:nth-of-type(2)').textContent)
            .toBe('first part, second part, third part.');
    });

    let loc2_id, path_id, somewhere_else_game_state;
    it("should let you add a path", async () => {
        [loc2_id, path_id] = await Promise.all([
            add(`type=location&name=somewhere+else`),
            add(`type=path&item=${location_id}`)]);
        expect((await post('/change/item',
            `type=path&id=${path_id}&newitem=${loc2_id}&game=${game_id}`, user1))
            .statusCode).toBe(204);
        const doc = await document(
            `/play?cmd=go+to+somewhere+else&gameState=${have_thing_game_state}`);
        expect(doc.querySelector('p').textContent).toBe('');
        expect(doc.querySelector('p:nth-of-type(2)').textContent).toBe('');
        somewhere_else_game_state = state(doc);
    });

    it("should let you do an action on something in your inventory", async () => {
        expect((await document(`/play?cmd=use+thing&gameState=${somewhere_else_game_state}`))
            .querySelector('p:nth-of-type(2)').textContent).toBe('Something happens!');
    });

    it("should let you add a constraint", () =>
        add(`type=constraint&parenttype=action&item=${action_id}&obj=${object_id}`)
    );

    it("should let you add an effect", () =>
        add(`type=effect&parenttype=action&item=${action_id}&obj=${object_id}&name=on`)
    );

    it("should let constraints and effects work", async () => {
        const doc = await document(`/play?cmd=use+thing&gameState=${start_game_state}`);
        expect(doc.querySelector('p:nth-of-type(2)').textContent).toBe('Something happens!');
        expect((await document(`/play?cmd=use+thing&gameState=${state(doc)}`))
            .querySelector('p:nth-of-type(2)').textContent).toBe('Nothing happens.');
    });

    const document = async url => new JSDOM(await response(await get(url, user1))).window.document;

    const state = document => document.querySelector('input[name=gameState]').value;

    async function add(query) {
        const req = await post('/add', `${query}&game=${game_id}`, user1);
        expect(req.statusCode).toBe(200);
        return await response(req);
    }
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
    req.on('end', () => resolve(req.headers['content-type'] === 'application/json' ?
        JSON.parse(data) : data));
    req.on('error', reject);
});