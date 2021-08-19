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
        expect(await response(await get('/check/username?name=user'))).toBe(1);
        expect(await response(await get('/check/username?name=not_taken'))).toBe(0);
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
        const text = "You are in a test game.";
        expect((await post('/change/start-text',
            `game=${game_id}&text=${encodeURIComponent(text)}`, user1)).statusCode).toBe(204);
        expect((await play_game(game_id).next()).value[0]).toBe(text);
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

    let action_id;
    it("should let you add an action", async () => {
        action_id = await add(`type=action&item=${object_id}`);
    });

    it("should let you add text to an action", async () => {
        expect((await post('/change/description',
            `type=action&id=${action_id}&text=Something+happens!&game=${game_id}`, user1)).statusCode).toBe(204);
    });

    it("should let you do an action on an object in your location", async () => {
        const game = play_game(game_id);
        await game.next();
        expect((await game.next('use thing')).value[1]).toBe('Something happens!');
    });

    let loc2_id, path_id;
    it("should let you add a path", async () => {
        [loc2_id, path_id] = await Promise.all([
            add(`type=location&name=somewhere+else`),
            add(`type=path&item=${location_id}`)]);
        expect((await post('/change/item',
            `type=path&id=${path_id}&newitem=${loc2_id}&game=${game_id}`, user1))
            .statusCode).toBe(204);
        const game = play_game(game_id);
        await game.next();
        const { value: [description, text] } =
            await game.next('go to somewhere else');
        expect(description).toBe('');
        expect(text).toBe('');
    });

    let grab_id;
    it("should let you add a pick up action", async () => {
        grab_id = await add(`type=grab&item=${object_id}`, user1);
    });

    it("should let you pick up the object", async () => {
        const game = play_game(game_id);
        await game.next();
        const { value: [, text, inventory] } = await game.next('pick up thing');
        expect(text).toBe('You have a thing.');
        expect(inventory).toBe('You have: thing.');
    });

    it("should let you do an action on something in your inventory", async () => {
        const game = play_game(game_id);
        await game.next();
        await game.next('pick up thing');
        await game.next('go to somewhere else');
        expect((await game.next('use thing')).value[1]).toBe('Something happens!');
    });

    it("should let you disable picking up the object", async () => {
        expect((await post('/change/item',
            `type=grab&id=${grab_id}&state=false&game=${game_id}`, user1)).statusCode).toBe(204);
        const game = play_game(game_id);
        await game.next();
        expect((await game.next('pick up thing')).value.slice(1))
            .toEqual(['Nothing happens.', '']);
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
        expect((await play_game(game_id).next()).value[1])
            .toBe('first part, second part, third part.');
    });

    it("should let constraints and effects work", async () => {
        await add(`type=constraint&parenttype=action&item=${action_id}&obj=${object_id}&value=default`);
        await add(`type=effect&parenttype=action&item=${action_id}&obj=${object_id}&value=on`);
        await add(`type=constraint&parenttype=grab&item=${grab_id}&obj=${object_id}&value=on`);
        await add(`type=effect&parenttype=grab&item=${grab_id}&obj=${object_id}&value=default`);
        await post('/change/description',
            `type=grab&id=${grab_id}&text=You+don't+get+it.&game=${game_id}`, user1);
        const game = play_game(game_id);
        await game.next();
        expect((await game.next('pick up thing')).value[1]).toBe('Nothing happens.');
        expect((await game.next('use thing')).value[1]).toBe('Something happens!');
        expect((await game.next('use thing')).value[1]).toBe('Nothing happens.');
        expect((await game.next('pick up thing')).value[1]).toBe("You don't get it.");
        expect((await game.next('use thing')).value[1]).toBe('Something happens!');
    });

    it("should let you remove a constraint", async () => {
        await remove(`type=constraint&parenttype=grab&item=${grab_id}&obj=${object_id}`);
        const game = play_game(game_id);
        await game.next();
        expect((await game.next('pick up thing')).value[1]).toBe("You don't get it.");
    });

    it("should let description constraints work", async () => {
        await add(`item=${description_ids[0]
            }&type=constraint&parenttype=description&obj=${object_id}&value=default`);
        await add(`item=${description_ids[1]
            }&type=constraint&parenttype=description&obj=${object_id}&value=on`);
        const game = play_game(game_id);
        expect((await game.next()).value[1]).toBe('first part, third part.');
        expect((await game.next('use thing')).value[0]).toBe('second part, third part.');
    });

    it("should let location constraints and effects work", async () => {
        await add(`type=location-effect&obj=${object_id}&value=${loc2_id
            }&parenttype=grab&item=${grab_id}`);
        await add(`type=location-constraint&obj=${object_id}&value=${loc2_id
            }&parenttype=path&item=${path_id}`);
        await add(`type=location-constraint&obj=${object_id}&value=${location_id
            }&parenttype=grab&item=${grab_id}`);
        const game = play_game(game_id);
        await game.next();
        expect((await game.next('go to somewhere else')).value[1]).toBe('Nothing happens.');
        expect((await game.next('pick up thing')).value[1]).toBe("You don't get it.");
        expect((await game.next('use thing')).value[1]).toBe('Nothing happens.');
        expect((await game.next('go to somewhere else')).value[1]).toBe('');
        expect((await game.next('use thing')).value[1]).toBe('Something happens!');
        expect((await game.next('pick up thing')).value[1]).toBe('Nothing happens.'); 
    });

    it("should let inventory constraints and effects work", async () => {
        const id = await add(`type=action&item=${obj2_id}`);
        await post('/change/description',
            `type=action&id=${id}&text=You+get+it.&game=${game_id}`, user1);
        await add(`type=inventory-constraint&parenttype=action&obj=${
            obj2_id}&item=${action_id}&value=1`);
        await add(`type=inventory-effect&parenttype=action&obj=${obj2_id}&item=${id}`);
        await add(`type=inventory-constraint&parenttype=action&obj=${
            obj2_id}&item=${id}&value=0`);
        const game = play_game(game_id);
        await game.next();
        expect((await game.next('use thing')).value[1]).toBe('Nothing happens.');
        expect((await game.next('use other thing')).value.slice(1))
            .toEqual(['You get it.', 'You have: other thing.']);
        expect((await game.next('use thing')).value[1]).toBe('Something happens!');
        expect((await game.next('use other thing')).value[1]).toBe('Nothing happens.');
    });

    it("should let you add an alternate name to an object", async () => {
        await add(`type=name&obj=${obj2_id}&name=thing2`);
        const game = play_game(game_id);
        await game.next();
        expect((await game.next('use thing2')).value[1]).toBe('You get it.');
    });

    it("should let you remove an alternate name", async () => {
        await remove(`type=name&obj=${obj2_id}&name=thing2`);
        const game = play_game(game_id);
        await game.next();
        expect((await game.next('use thing2')).value[1]).toBe('Nothing happens.');
    });

    let action2_id;
    it("should let actions with two objects work", async () => {
        action2_id = await add(`type=action&item=${obj2_id}`);
        expect((await post('/change/item', `type=action&newitem=${object_id}&id=${
            action2_id}&game=${game_id}`, user1)).statusCode).toBe(204);
        expect((await post('/change/description',
            `type=action&id=${action2_id}&text=you+used+it&game=${
            game_id}`, user1)).statusCode).toBe(204);
        const game = play_game(game_id);
        await game.next();
        expect((await game.next('use other thing on thing')).value[1])
            .toBe("You don't have an other thing.");
        await game.next('use other thing');
        expect((await game.next('use other thing on thing')).value[1])
            .toBe('you used it');
        await game.next('pick up thing');
        expect((await game.next('use other thing on thing')).value[1])
            .toBe('Nothing happens.');
    });

    it("should let you put states on locations", async () => {
        await add(`type=constraint&parenttype=action&item=${action2_id}&loc=${location_id}&value=default`);
        await add(`type=effect&parenttype=action&item=${action2_id}&loc=${location_id}&value=used`);
        const game = play_game(game_id);
        await game.next();
        await game.next('use other thing');
        expect((await game.next('use other thing on thing')).value[1]).toBe('you used it');
        expect((await game.next('use other thing on thing')).value[1]).toBe('Nothing happens.');
    });

    it("should not let unauthorized users play the game", async () => {
        user2 = (await post('/signup', 'username=other+guy&password=some_pass&url='))
            .headers['set-cookie'][0];
        expect((await get(`/start?game=${game_id}`, user2)).statusCode).toBe(401);
    });

    it("should let you send a join link", async () => {
        const req = await get(`/join-link?game=${game_id}`, user1);
        expect(req.statusCode).toBe(200);
        const link = await response(req);
        expect((await get(`/join?token=${link}`, user2)).statusCode).toBe(307);
        expect((await get(`/start?game=${game_id}`, user2)).statusCode).toBe(200);
    });

    async function add(query) {
        const req = await post('/add', `${query}&game=${game_id}`, user1);
        expect(req.statusCode).toBe(200);
        return await response(req);
    }

    async function remove(query) {
        const req = await request('DELETE', `/remove?${query}&game=${game_id}`, user1);
        expect(req.statusCode).toBe(204);
    }

    async function* play_game(game_id) {
        const document = async url =>
            new JSDOM(await response(await get(url, user1))).window.document;
        let doc = await document(`/start?game=${game_id}`);
        while (true) {
            const cmd = yield [...doc.querySelectorAll('p')].map(a => a.textContent);
            doc = await document(`/play?cmd=${encodeURIComponent(cmd)}&gameState=${
                doc.querySelector('input[name=gameState').value}`);
        }
    }
});

function get(url, cookie) {
    return request('GET', url, cookie);
}

function post(url, body, cookie) {
    return request('POST', url, cookie, body);
}

const request = (method, url, cookie, body) => new Promise(resolve => {
    const headers = { 'x-forwarded-proto': 'https' };
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