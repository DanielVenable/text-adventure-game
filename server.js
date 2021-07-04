'use strict';

const cluster = require('cluster');

if (process.env.NODE_ENV !== 'production') {
	require('dotenv').config();
}

if (cluster.isMaster) {
	for (let i = 0; i < (process.env.WEB_CONCURRENCY || 1); i++) cluster.fork();
} else {
	const http = require('http'),
		fs = require('fs'),
		util = require('util'),
		crypto = require('crypto'),
		jwt = require('jsonwebtoken'),
		cookie = require('cookie'),
		pg = require('pg'),
		pg_format = require('pg-format'),
		port = +process.env.PORT || 80;

	const client = new pg.Client({
		connectionString: process.env.DATABASE_URL,
		ssl: {
			rejectUnauthorized: false
		}
	});

	async function query(str, arr = []) {
		return (await client.query(pg_format(str, ...arr))).rows;
	}

	process.chdir(__dirname + '/files');

	class StrictMap extends Map {
		get(key) {
			if (!this.has(key)) throw new Error('Invalid value for StrictMap');
			return super.get(key);
		}
	}

	const files = {
		async get(path) {
			if (!files[path]) {
				files[path] = String(await fs.promises.readFile(path));
			}
			return files[path];
		}
	}, table_list = new StrictMap([
		['action', 'actions'],
		['grab', 'grab'],
		['path', 'paths'],
		['description', 'descriptions']
	]), start_table_list = new StrictMap([
		['action', 'action_to_'],
		['grab', 'grab_to_'],
		['path', 'path_to_'],
		['description', 'description_to_']
	]), column_list = new StrictMap([
		['action', 'action'],
		['grab', 'grab'],
		['path', 'path'],
		['description', 'description']
	]), win_value_list = new StrictMap([
		['1', 1], ['0', 0], ['null', null]
	]);

	client.connect().then(() =>
		http.createServer(async (req, res) => {
			if (req.headers['x-forwarded-proto'] !== 'https' &&
					process.env.NODE_ENV === 'production') {
				res.statusCode = 308;
				res.setHeader('Location', `https://${req.headers.host}${req.url}`);
				return res.end();
			}
			let userid;
			try {
				try {
					userid = jwt.verify(
						cookie.parse(req.headers.cookie).token, jwtKey).id;
				} catch { }
				res.setHeader('Content-Type', 'text/html');
				res.statusCode = 200;
				const url = new URL(req.url, `https://${req.headers.host}`);
				if (req.method === 'GET') {
					res.end(stringify(await get(url.pathname, url.searchParams, userid, res)));
				} else if (req.method === 'POST') {
					let data = '?';
					req.on('data', chunk => data += chunk);
					await new Promise(resolve => req.on('end', resolve));
					res.end(stringify(await post(url.pathname,
						new URL(data, `https://${req.headers.host}`).searchParams, userid, res)));
				} else if (req.method === 'DELETE') {
					if (url.pathname === '/remove') {
						await remove(url.searchParams, userid, res);
					} else res.statusCode = 400;
				} else res.statusCode = 405;

				function stringify(obj) {
					if (typeof obj === 'string' || obj === undefined) return obj;
					res.setHeader('Content-Type', 'application/json');
					return JSON.stringify(obj);
				}
			} catch (error) {
				if (error === 'Unauthorized action') {
					res.statusCode = 401;
					if (req.method === 'GET' && !userid) {
						res.end(await show_file('sign-in.html', await navbar(userid),
							sanitize(req.url), 'hidden', sanitize(req.url)));
					}
				} else {
					res.statusCode = 400;
					console.error(error);
				}
			} finally {
				if (!res.writableEnded) res.end();
			}
		}).listen(port, () => console.log('Server running at port %d', port)));

	async function get(path, data, userid, res) {
		const game = data.get('game');
		let permission;
		if (game) {
			permission = await query(`
				SELECT permission FROM user_to_game
				WHERE user_ = %L AND game = %L`,
				[userid, game]);
		}
		switch (path) {
			case '/play': {
				const { data: [
					state_list,
					locationID, inventory_list,
					moved_object_list, location_list], moves
				} = jwt.verify(data.get('gameState'), jwtKey),
					[{ game: gameid }] = await query(`
						SELECT game FROM locations
						WHERE id = %L`, [locationID]),
					game = await query(`
						SELECT public, name FROM games
						WHERE id = %L`, [gameid]),
					moved_objects = new Map(),
					states = new Set(state_list),
					inventory = new Set(inventory_list);
				for (let i = 0; i < moved_object_list.length; i++) {
					moved_objects.set(moved_object_list[i], location_list[i]);
				}
				if (!game[0].public) {
					restrict(await query(`
						SELECT permission FROM user_to_game
						WHERE user_ = %L AND game = %L`,
						[userid, gameid]
					), 0);
				}
				const show_data = {
					game: game[0].name, states, moved_objects, gameid,
					location: locationID, inventory, moves, userid
				};
				if (!data.has('cmd')) return await show(show_data, '');
				const command = data.get('cmd').toLowerCase();
				let split_go_to,
					split_pick_up,
					split_use;
				if (split_go_to = command.match(/^go (?:to )?(.+)$/)) {
					const end_location = await query(`
						SELECT id FROM locations
						WHERE name = %L AND game = %L`,
						[split_go_to[1], gameid]);
					if (end_location.length === 1) {
						const constraints = await query(`
							SELECT paths.id, paths.text, paths.win,
								constraint_and_effect.id AS state,
								constraint_and_effect.obj,
								constraint_and_effect.loc,
								constraint_and_effect.name IS NOT NULL AS should_be_there,
								location_constraint_and_effect.obj AS loc_obj,
								location_constraint_and_effect.location,
								path_to_inventory_constraint.obj AS inv_obj,
								path_to_inventory_constraint.have_it FROM paths
							LEFT JOIN path_to_constraint
								ON paths.id = path_to_constraint.path
							LEFT JOIN constraint_and_effect
								ON constraint_and_effect.id =
									path_to_constraint.constraint_
							LEFT JOIN path_to_location_constraint
								ON paths.id = path_to_location_constraint.path
							LEFT JOIN location_constraint_and_effect
								ON location_constraint_and_effect.id =
									path_to_location_constraint.constraint_
							LEFT JOIN path_to_inventory_constraint
								ON paths.id = path_to_inventory_constraint.path
							WHERE paths.start = %L AND paths.end_ = %L
							ORDER BY paths.id;`,
							[locationID, end_location[0].id]);
						const result = await satisfy_constraints(show_data, constraints);
						if (result) {
							if (result.win === null) {
								const effects = await query(`
									SELECT constraint_and_effect.id AS state,
										constraint_and_effect.name IS NOT NULL AS should_be_there,
										location_constraint_and_effect.obj AS loc_obj,
										location_constraint_and_effect.location,
										path_to_inventory_effect.obj AS inv_obj FROM paths
									LEFT JOIN path_to_effect
										ON paths.id = path_to_effect.path
									LEFT JOIN constraint_and_effect
										ON constraint_and_effect.id =
											path_to_effect.effect
									LEFT JOIN path_to_location_effect
										ON paths.id = path_to_location_effect.path
									LEFT JOIN location_constraint_and_effect
										ON location_constraint_and_effect.id =
											path_to_location_effect.effect
									LEFT JOIN path_to_inventory_effect
										ON paths.id = path_to_inventory_effect.path
									WHERE paths.start = %L AND paths.end_ = %L`,
									[locationID, end_location[0].id]);
								await handle_effects(show_data, effects);
								show_data.location = end_location[0].id;
								return await show(show_data, result.text);
							} else return await win_lose(show_data, result);
						} else return await show(show_data, 'Nothing happens.');
					} else return await show(show_data, 'Nothing happens.');
				} else if (split_pick_up = command.match(/^(?:pick up|grab|get) (.+)$/)) {
					const obj = await objects_here(split_pick_up[1]);
					if (obj.length === 1) {
						if (inventory.has(obj[0].id)) {
							return await show(show_data, 'You already have it.');
						} else {
							const constraints = await query(`
								SELECT grab.id, grab.text, grab.success, grab.win,
									constraint_and_effect.id AS state,
									constraint_and_effect.obj,
									constraint_and_effect.loc,
									constraint_and_effect.name IS NOT NULL AS should_be_there,
									location_constraint_and_effect.obj AS loc_obj,
									location_constraint_and_effect.location,
									grab_to_inventory_constraint.obj AS inv_obj,
									grab_to_inventory_constraint.have_it FROM grab
								LEFT JOIN grab_to_constraint
									ON grab.id = grab_to_constraint.grab
								LEFT JOIN constraint_and_effect
									ON constraint_and_effect.id =
										grab_to_constraint.constraint_
								LEFT JOIN grab_to_location_constraint
									ON grab.id = grab_to_location_constraint.grab
								LEFT JOIN location_constraint_and_effect
									ON location_constraint_and_effect.id =
										grab_to_location_constraint.constraint_
								LEFT JOIN grab_to_inventory_constraint
									ON grab.id = grab_to_inventory_constraint.grab
								WHERE grab.obj = %L
								ORDER BY grab.id`, [obj[0].id]);
							const result = await satisfy_constraints(show_data, constraints);
							if (result) {
								if (result.win === null) {
									const effects = await query(`
										SELECT constraint_and_effect.id AS state,
											constraint_and_effect.name IS NOT NULL AS should_be_there,	
											location_constraint_and_effect.obj AS loc_obj,
											location_constraint_and_effect.location,
											grab_to_inventory_effect.obj AS inv_obj FROM grab
										LEFT JOIN grab_to_effect
											ON grab.id = grab_to_effect.grab
										LEFT JOIN constraint_and_effect
											ON constraint_and_effect.id =
												grab_to_effect.effect
										LEFT JOIN grab_to_location_effect
											ON grab.id = grab_to_location_effect.grab
										LEFT JOIN location_constraint_and_effect
											ON location_constraint_and_effect.id =
												grab_to_location_effect.effect
										LEFT JOIN grab_to_inventory_effect
											ON grab.id = grab_to_inventory_effect.grab
										WHERE grab.id = %L`, [result.id]);
									await handle_effects(show_data, effects);
									if (result.success) {
										inventory.add(obj[0].id);
										return await show(show_data,
											result.text ? result.text + ' ' : '' +
												`You have ${a_an(split_pick_up[1])}.`);
									} else return await show(show_data,
										result.text || "Nothing happens.");
								} else return await win_lose(show_data, result);
							} else return await show(show_data, "Nothing happens.");
						}
					} else return await show(show_data, "Nothing happens.");
				} else if (split_use = command.match(/^use (?:(.+) on )?(.+)$/)) {
					if (split_use[1] === undefined) {
						return await use_on(null, split_use[2]);
					} else {
						const item1 = await query(`
							SELECT id FROM objects
							WHERE name = %L`, [split_use[1]]);
						if (item1.length === 1 && inventory.has(item1[0].id)) {
							return await use_on(item1[0].id, split_use[2]);
						} else return await show(show_data,
							`You don't have ${a_an(split_use[1])}.`);
					}
					async function use_on(first_ID, second_name) {
						const valid_items = await objects_here(second_name, true);
						if (valid_items.length === 1) {
							const constraints = await query(`
								SELECT actions.id, actions.text, actions.win,
									constraint_and_effect.id AS state,
									constraint_and_effect.obj,
									constraint_and_effect.loc,
									constraint_and_effect.name IS NOT NULL AS should_be_there,
									location_constraint_and_effect.obj AS loc_obj,
									location_constraint_and_effect.location,
									action_to_inventory_constraint.obj AS inv_obj,
									action_to_inventory_constraint.have_it FROM actions
								LEFT JOIN action_to_constraint
									ON actions.id = action_to_constraint.action
								LEFT JOIN constraint_and_effect
									ON constraint_and_effect.id =
										action_to_constraint.constraint_
								LEFT JOIN action_to_location_constraint
									ON actions.id = action_to_location_constraint.action
								LEFT JOIN location_constraint_and_effect
									ON location_constraint_and_effect.id =
										action_to_location_constraint.constraint_
								LEFT JOIN action_to_inventory_constraint
									ON actions.id = action_to_inventory_constraint.action
								WHERE actions.obj1 = %L AND actions.obj2 %s`,
								first_ID ?
									[first_ID, pg_format('= %L', valid_items[0].id)] :
									[valid_items[0].id, 'IS NULL']);
							const result = await satisfy_constraints(show_data, constraints);
							if (result) {
								if (result.win === null) {
									const effects = await query(`
										SELECT constraint_and_effect.id AS state,
											constraint_and_effect.name IS NOT NULL AS should_be_there,
											location_constraint_and_effect.obj AS loc_obj,
											location_constraint_and_effect.location,
											action_to_inventory_effect.obj AS inv_obj FROM actions
										LEFT JOIN action_to_effect
											ON actions.id = action_to_effect.action
										LEFT JOIN constraint_and_effect
											ON constraint_and_effect.id =
												action_to_effect.effect
										LEFT JOIN action_to_location_effect
											ON actions.id = action_to_location_effect.action
										LEFT JOIN location_constraint_and_effect
											ON location_constraint_and_effect.id =
												action_to_location_effect.effect
										LEFT JOIN action_to_inventory_effect
											ON actions.id = action_to_inventory_effect.action
										WHERE actions.id = %L`, [result.id]);
									await handle_effects(show_data, effects);
									return await show(show_data,
										result.text ? result.text : "Nothing happens.");
								} else return await win_lose(show_data, result);
							} else return await show(show_data, "Nothing happens.");
						} else return await show(show_data, "Nothing happens.");
					}
				} else return await show(show_data, "Invalid command.");

				async function objects_here(name, include_inventory = false) {
					const obj = await query(`
						SELECT id, location FROM objects
						WHERE name = %L AND game = %L`,
						[name, gameid]);
					return obj.filter(({ id, location }) =>
						location === locationID ^
							moved_object_list.includes(id) ||
						include_inventory && inventory.has(id));
				}
			} case '/': {
				const listify = path => (acc, { id, name }) =>
					acc + `<li><a href="/${path}?game=${id}">${sanitize(name)}</a></li>`;
				const public_game_list = (await query(`
					SELECT id, name FROM games
					WHERE start IS NOT NULL AND public = TRUE
					ORDER BY name`))
					.reduce(listify('start'), '');
				let private_list = '', edit_list = '';
				if (userid) {
					private_list = (await query(`
						SELECT games.id, games.name FROM games
						JOIN user_to_game ON user_to_game.game = games.id
						WHERE games.start IS NOT NULL
							AND games.public = FALSE
							AND user_to_game.user_ = %L
						ORDER BY games.name`, [userid]))
						.reduce(listify('start'), '');
					edit_list = (await query(`
						SELECT games.id, games.name FROM games
						JOIN user_to_game ON user_to_game.game = games.id
						WHERE user_to_game.user_ = %L AND user_to_game.permission >= 1
						ORDER BY games.name`, [userid]))
						.reduce(listify('edit'), '');
				}
				return await show_file('home-page.html',
					await navbar(userid), public_game_list, private_list, ...(userid ?
						['hidden', '', edit_list] : ['', 'hidden', '']));
			} case '/start': {
				const [result] = await query(`
					SELECT locations.id, games.text, games.public, games.name FROM games
					JOIN locations ON locations.id = games.start
					WHERE games.id = %L`, [game]);
				if (!result.public) restrict(permission, 0);
				const list = Array(5).fill([]);
				list[1] = result.id;
				return await show_file('play.html',
					sanitize(result.name),
					await navbar(userid),
					show_newlines(sanitize(result.text)),
					await describe({
						location: result.id,
						states: new Set,
						moved_objects: new Map,
						inventory: new Set
					}),
					jwt.sign({ data: list, moves: 0 }, jwtKey),
					'', +game, +game);
			} case '/edit': {
				const [{ start, name, text }] = await query(`
						SELECT start, name, text FROM games
						WHERE id = %L`, [game]),
					permission = await query(`
						SELECT permission FROM user_to_game
						WHERE user_ = %L AND game = %L`,
						[userid, game]);
				restrict(permission, 1);
				const location_list = await
					(await query(`
						SELECT id, name FROM locations WHERE game = %L`, [game])
					).reduce(
						async (acc, { id, name }) =>
							await acc + await show_file('location.html', id, ...(start === id ?
								[' class="start"', sanitize(name), 'hidden'] :
								['', sanitize(name), ''])), '');
				const obj_list = await
					(await query(`
						SELECT id, name FROM objects
						WHERE location IS NULL AND game = %L`,
						[game])
					).reduce(
						async (acc, { id, name }) =>
							await acc + await show_file('object.html', id, sanitize(name)), '');
				let operator_controls = '';
				if (permission[0].permission >= 2) {
					const users = await query(`
						SELECT users.username, user_to_game.permission, users.id
						FROM user_to_game JOIN users
						ON user_to_game.user_ = users.id
						WHERE user_to_game.game = %L
						AND users.id != %L`, [game, userid]);
					let list = '';
					for (const user of users) {
						let opts = ['', '', ''];
						opts[user.permission] = 'selected';
						list += await show_file('user.html',
							user.id, sanitize(user.username), ...opts);
					}
					operator_controls = await show_file('operator-controls.html', list);
				}
				const game_id = encodeURIComponent(game);
				return await show_file('edit.html',
					sanitize(name), await navbar(userid),
					sanitize(text), location_list, obj_list,
					game_id, operator_controls, game_id);
			} case '/signin':
				return await show_file('sign-in.html',
					await navbar(userid), '/', 'hidden', '/');
			case '/navbar.css':
				res.setHeader('Content-Type', 'text/css');
				return await show_file('navbar.css');
			case '/expand':
				restrict(permission, 1);
				switch (data.get('type')) {
					case 'location': {
						await location_match_game(data.get('id'), game);
						return await Promise.all([
							get_description_constraint_array(data.get('id')),
							query(`
								SELECT name, id FROM objects
								WHERE location = %L AND game = %L`,
								[data.get('id'), game]),
							query(`
								SELECT id, end_ AS end, win FROM paths
								WHERE start = %L`, [data.get('id')])
						]);
					} case 'object': {
						await object_match_game(data.get('id'), game);
						return await Promise.all([
							query(`
								SELECT id, obj2, win FROM actions 
								WHERE obj1 = %L`, [data.get('id')]),
							query(`
								SELECT id, success, win FROM grab
								WHERE grab.obj = %L`, [data.get('id')])
						]);
					} case 'action':
					case 'grab':
					case 'path': {
						await action_match_game(
							data.get('type'), data.get('id'), game);
						const table_part = start_table_list.get(data.get('type')),
							column = column_list.get(data.get('type'));
						const sql = `
							SELECT constraint_and_effect.obj,
								constraint_and_effect.loc,
								constraint_and_effect.name
								FROM constraint_and_effect
							JOIN %I ON constraint_and_effect.id = %I.%I
							WHERE %I.%I = %L`,
							location_sql = `
							SELECT location_constraint_and_effect.obj,
								location_constraint_and_effect.location
								FROM location_constraint_and_effect
							JOIN %I ON location_constraint_and_effect.id = %I.%I
							WHERE %I.%I = %L`,
							params = type => {
								const table = table_part + type;
								return [
									table, table,
									/effect/.test(type) ? 'effect' : 'constraint_',
									table, column, data.get('id')
								];
							};
						return await Promise.all([
							query(sql, params('constraint')),
							query(sql, params('effect')),
							query(location_sql, params('location_constraint')),
							query(location_sql, params('location_effect')),
							query(`SELECT obj, have_it FROM %I WHERE %I = %L`,
								[table_part + 'inventory_constraint',
									column, data.get('id')]),
							query(`SELECT obj FROM %I WHERE %I = %L`,
								[table_part + 'inventory_effect',
									column, data.get('id')]),
							query(`SELECT text FROM %I WHERE id = %L`,
								[table_list.get(data.get('type')), data.get('id')])
									.then(a => a[0].text)
						]);
					} default: res.statusCode = 400;
				}
				break;
			case '/how-to-make-a-game':
				return await show_file('instructions.html', await navbar(userid));
			case '/check/username':
				return (await query(`
					SELECT COUNT(*) AS num FROM users
					WHERE username = %L`, [data.get('name')]))[0].num;
			case '/all-objects':
				restrict(permission, 1);
				return await query(`
					SELECT objects.id, objects.name,
						objects.location AS loc_id, locations.name AS loc_name FROM objects
					FULL JOIN locations ON objects.location = locations.id
					WHERE objects.game = %L ORDER BY objects.location`, [game]);
			case '/all-states':
				restrict(permission, 1);
				return await query(`
					SELECT obj, loc, name FROM constraint_and_effect
					WHERE game = %L`, [game]);
			case '/join-link':
				restrict(permission, 2);
				res.setHeader('Content-Type', 'text/plain');
				return jwt.sign({
					id: Number(game)
				}, jwtKey, {
					expiresIn: '5 days'
				});
			case '/join': {
				if (!userid) throw 'Unauthorized action';
				const game = jwt.verify(data.get('token'), jwtKey).id;
				const valid = await query(`
					SELECT COUNT(*) AS valid FROM user_to_game
					WHERE user_ = %L AND game = %L`, [userid, game]);
				if (!valid[0].valid)
					await query(`
						INSERT INTO user_to_game (user_, game)
						VALUES (%L, %L)`, [userid, game]);
				res.statusCode = 307;
				res.setHeader('Location', '/');
				break;
			} default:
				res.statusCode = 404;
				return await show_file('404.html');
		}
	}


	async function post(path, data, userid, res) {
		const game = data.get('game');
		const permission = await query(`
			SELECT permission FROM user_to_game
			WHERE user_ = %L AND game = %L`,
			[userid, game]);
		switch (path) {
			case '/create': {
				if (!userid) throw 'Unauthorized action';
				const game = await query(`
					INSERT INTO games (name, text) VALUES (%L, '') RETURNING id`,
					[data.get('name')]);
				await query(`
					INSERT INTO user_to_game (user_, game, permission)
					VALUES (%L, %L, 2)`, [userid, game[0].id]);
				return game[0].id;
			} case '/signin': {
				const user = await query(`
					SELECT id FROM users WHERE username = %L AND hash = %L`,
					[data.get('username'), crypto.createHash('sha256')
						.update(data.get('password')).digest('hex')]);
				if (user.length) {
					create_token(res, user[0].id);
					res.setHeader('Location', data.get('url'));
					res.statusCode = 303;
				} else {
					res.statusCode = 401;
					return await show_file('sign-in.html',
						await navbar(userid), data.get('url'), '', data.get('url'));
				}
				break;
			} case '/signup': {
				if (data.get('password').length < 8 || data.get('username') === '') {
					res.statusCode = 400;
					break;
				}
				const hash = crypto.createHash('sha256')
					.update(data.get('password'))
					.digest('hex');
				const [{ id }] = await query(`
					INSERT INTO users (username, hash) VALUES (%L, %L)
					RETURNING id`,
					[data.get('username'), hash]);
				create_token(res, id);
				res.setHeader('Location', data.get('url'));
				res.statusCode = 303;
				break;
			} case '/signout': {
				res.setHeader('Set-Cookie', cookie.serialize('token', '', { maxAge: 0 }));
				res.setHeader('Location', '/');
				res.statusCode = 303;
				break;
			} case '/add': {
				restrict(permission, 1);
				switch (data.get('type')) {
					case 'location': {
						const name = data.get('name').toLowerCase();
						return (await query(`
							INSERT INTO locations (game, name)
							VALUES (%L,%L) RETURNING id`,
							[game, name]))[0].id
					} case 'object': {
						const is_anywhere = !isNaN(data.get('location'));
						if (is_anywhere) {
							await location_match_game(data.get('location'), game);
						}
						return (await query(`
							INSERT INTO objects (game, name, location)
							VALUES (%L,%L,%L) RETURNING id`,
							[game, data.get('name').toLowerCase(),
							is_anywhere ? data.get('location') : null]))[0].id;
					} case 'action': {
						await object_match_game(data.get('item'), game);
						return (await query(`
							INSERT INTO actions (obj1) VALUES (%L) RETURNING id`,
							[data.get('item')]))[0].id;
					} case 'grab': {
						await object_match_game(data.get('item'), game);
						return (await query(`
							INSERT INTO grab (obj) VALUES (%L) RETURNING id`,
							[data.get('item')]))[0].id;
					} case 'path': {
						await location_match_game(data.get('item'), game);
						return (await query(`
							INSERT INTO paths (start) VALUES (%L) RETURNING id`,
							[data.get('item')]))[0].id;
					} case 'description': {
						await location_match_game(data.get('item'), game);
						await query(`
							UPDATE descriptions
							SET num = num + 1
							WHERE location = %L AND num >= %L`,
							[data.get('item'), data.get('num')]);
						return (await query(`
							INSERT INTO descriptions (location, num, text)
							VALUES (%L, %L, '') RETURNING id`,
							[data.get('item'), data.get('num')]))[0].id;
					} default: {
						if (data.has('obj')) {
							if (data.has('loc')) return;
							await object_match_game(data.get('obj'), game);
						}
						await action_match_game(data.get('parenttype'), data.get('item'), game);
						const [, type1, type2] = data.get('type').match(
							/^(location-|inventory-)?(constraint|effect)$/);
						const select_params = [data.get('obj'), data.get('value')];
						let id, table;
						if (!type1) {
							if (data.has('loc')) {
								await location_match_game(data.get('loc'), game);
							}
							table = start_table_list.get(data.get('parenttype')) + type2;
							
							const params = [
								data.get('obj'), data.get('loc'),
								data.has('name') ? data.get('name').toLowerCase() : null];
							const exists = await query(`
								SELECT id FROM constraint_and_effect
								WHERE (obj = %L OR loc = %L) AND name = %L`, params);
							[{ id }] = exists.length ? exists : await query(`
								INSERT INTO constraint_and_effect (game, obj, loc, name)
								VALUES (%L, %L, %L, %L) RETURNING id`, [game, ...params]);
						} else if (type1 === 'location-') {
							await location_match_game(data.get('value'), game);
							const exists = await query(`
								SELECT id FROM location_constraint_and_effect
								WHERE obj = %L AND location = %L`, select_params);
							id = exists.length ? exists[0].id : (await query(`
								INSERT INTO location_constraint_and_effect
									(obj, location)
								VALUES (%L, %L) RETURNING id`, select_params))[0].id;
							table = start_table_list.get(data.get('type')) +
								'location' + type2;
						} else if (type1 === 'inventory-') {
							const table = start_table_list.get(data.get('parenttype')) +
								'inventory_' + type2;
							if (type2 === 'constraint') {
								await query(`
									INSERT INTO %I (%I, obj, have_it)
									VALUES (%L, %L, %L)`,
									[table, column_list.get(data.get('parenttype')),
										data.get('item'), data.get('obj'),
										!!+data.get('value')]);
							} else {
								await query(`
									INSERT INTO %I (%L, obj) VALUES (%L, %L)`,
									[table, column_list.get(data.get('parenttype')),
										data.get('item'), data.get('obj')]);
							}
							break;
						}
						await query(`
							INSERT INTO %I (%I, %I) VALUES (%L, %L)`,
							[table,
								column_list.get(data.get('parenttype')),
								type2 === 'constraint' ? 'constraint_' : 'effect',
								data.get('item'), id]);
					}
				}
				break;
			} case '/setstart': {
				restrict(permission, 1);
				await location_match_game(data.get('id'), game);
				await query(`
					UPDATE games SET start = %L
					WHERE id = %L`, [data.get('id'), game]);
				res.statusCode = 204;
				break;
			} case '/rename': {
				restrict(permission, 1);
				let table;
				if (data.get('type') === 'location') {
					await location_match_game(data.get('id'), game);
					table = 'locations';
				} else if (data.get('type') === 'object') {
					await object_match_game(data.get('id'), game);
					table = 'objects';
				} else throw 'Invalid type';
				await query(`UPDATE %I SET name = %L WHERE id = %L`,
					[table, data.get('name').toLowerCase(), data.get('id')]);
				res.statusCode = 204;
				break;
			} case '/change/start-text': {
				restrict(permission, 1);
				await query(`
					UPDATE games SET text = %L
					WHERE id = %L`, [data.get('text'), game]);
				res.statusCode = 204;
				break;
			} case '/change/description': {
				restrict(permission, 1);
				if (data.get('type') === 'location') {
					const valid = await query(`
						SELECT COUNT(*) AS valid FROM locations
						JOIN descriptions ON descriptions.location = locations.id
						WHERE locations.game = %L AND descriptions.id = %L`,
						[game, data.get('id')]);
					if (!valid[0].valid) throw 'Description does not match game';
					await query(`
						UPDATE descriptions SET text = %L
						WHERE id = %L`,
						[data.get('text'), data.get('id')]);
				} else {
					await action_match_game(data.get('type'), data.get('id'), game);
					await query(`
						UPDATE %I SET text = %L
						WHERE id = %L`,
						[table_list.get(data.get('type')), data.get('text'), data.get('id')]);
				}
				res.statusCode = 204;
				break;
			} case '/change/item': {
				restrict(permission, 1);
				await action_match_game(data.get('type'), data.get('id'), game);
				if (data.get('type') === 'action') {
					await query(`
						UPDATE actions SET obj2 = %L
						WHERE id = %L`, [data.get('newitem'), data.get('id')]);
				} else if (data.get('type') === 'path') {
					await query(`
						UPDATE paths SET end_ = %L
						WHERE id = %L`, [data.get('newitem'), data.get('id')]);
				} else if (data.get('type') === 'grab') {
					await query(`
						UPDATE grab SET success = %L
						WHERE id = %L`, [data.get('state'), data.get('id')]);
				}
				res.statusCode = 204;
				break;
			} case '/change/win': {
				restrict(permission, 1);
				await action_match_game(data.get('type'), data.get('id'), game);
				await query(`
					UPDATE %I SET win = %L
					WHERE id = %L`,
					[table_list.get(data.get('type')),
					win_value_list.get(data.get('value')), data.get('id')]);
				res.statusCode = 204;
				break;
			} case '/change/permission': {
				restrict(permission, 2);
				if (data.get('permission') === '-1') {
					await query(`
						DELETE FROM user_to_game
						WHERE user_ = %L AND game = %L`,
						[data.get('user'), game]);
				} else if (['0', '1', '2'].includes(data.get('permission'))) {
					await query(`
						UPDATE user_to_game
						SET permission = %L
						WHERE user_ = %L AND game = %L`,
						[data.get('permission'), data.get('user'), game]);
				}
				res.statusCode = 204;
				break;
			} default: res.statusCode = 404;
		}
	}


	async function remove(data, userid, res) {
		const game = data.get('game');
		const permission = await query(`
			SELECT permission FROM user_to_game
			WHERE user_ = %L AND game = %L`,
			[userid, game]);
		res.statusCode = 204;
		restrict(permission, 1);
		switch (data.get('type')) {
			case 'game':
				restrict(permission, 2);
				await query(`
					DELETE FROM games
					WHERE id = %L`, [game]);
				break;
			case 'location':
				await query(`
					DELETE FROM locations
					WHERE id = %L AND game = %L`,
					[data.get('id'), game]);
				break;
			case 'object':
				await query(`
					DELETE FROM objects
					WHERE id = %L AND game = %L`,
					[data.get('id'), game]);
				break;
			case 'action':
			case 'grab':
			case 'path':
				await action_match_game(data.get('type'), data.get('id'), game);
				await query(`
					DELETE FROM %I WHERE id = %L`,
					[table_list.get(data.get('type')), data.get('id')]);
				break;
			case 'description':
				await location_match_game(
					data.get('item'), game);
				await query(`
					DELETE FROM descriptions
					WHERE location = %L AND num = %L`,
					[data.get('item'), data.get('num')]);
				await query(`
					UPDATE descriptions
					SET num = num - 1
					WHERE location = %L AND num > %L`,
					[data.get('item'), data.get('num')]);
				break;
			default: {
				await object_match_game(data.get('obj'), game);
				if (data.get('parenttype') === 'description') {
					const valid = await query(`
						SELECT COUNT(*) AS valid FROM descriptions
						JOIN locations ON descriptions.location = locations.id
						WHERE descriptions.id = %L AND locations.game = %L`,
						[data.get('item'), game]);
					if (!valid[0].valid) throw 'Action does not match game';
				} else await action_match_game(
					data.get('parenttype'), data.get('item'), game);
				const [, type1, type2] = data.get('type').match(
					/^(location-|inventory-)?(constraint|effect)$/);
				if (type1 === 'inventory-') {
					await query(`
						DELETE FROM %I WHERE obj = %L AND %I = %L`,
						[start_table_list.get(data.get('parenttype')) +
							'inventory_' + type2,
						data.get('obj'),
						column_list.get(data.get('parenttype')),
						data.get('item')]);
				} else {
					const table1 = start_table_list.get(data.get('parenttype')) +
						(type1 ? 'location_' : '') + type2;
					const table2 = (type1 ? 'location_' : '') +
						'constraint_and_effect';
					await query(`
						DELETE FROM %I USING %I
						WHERE %I.%I = %I.id
						AND %I.%I = %L
						AND %I.obj = %L`,
						[table1, table2, table1,
							type2 === 'constraint' ? 'constraint_' : 'effect',
							table2, table1, column_list.get(data.get('parenttype')),
							data.get('item'), table2, data.get('obj')]);
					if (['constraint', 'effect'].includes(data.get('type'))) await query(`
						DELETE FROM constraint_and_effect WHERE id = %L AND
						id NOT in (SELECT constraint_ FROM description_to_constraint) AND
						id NOT in (SELECT constraint_ FROM grab_to_constraint) AND
						id NOT in (SELECT effect FROM grab_to_effect) AND
						id NOT in (SELECT constraint_ FROM path_to_constraint) AND
						id NOT in (SELECT effect FROM path_to_effect) AND
						id NOT in (SELECT constraint_ FROM action_to_constraint) AND
						id NOT in (SELECT effect FROM action_to_effect)`, [data.get('item')]);
				}
			}
		}
	}


	async function location_match_game(location, game) {
		const valid = await query(`
			SELECT COUNT(*) AS valid FROM locations
			WHERE id = %L AND game = %L`, [location, game]);
		if (!valid[0].valid) throw 'Location does not match game';
	}

	async function object_match_game(object, game) {
		const valid = await query(`
			SELECT COUNT(*) AS valid FROM objects
			WHERE id = %L AND game = %L`, [object, game]);
		if (!valid[0].valid) throw 'Object does not match game';
	}

	const obj_column_map = new StrictMap([
		['action', 'obj1'], ['grab', 'obj'], ['path', 'start'], ['description', 'location']
	]);
	async function action_match_game(type, id, game) {
		const table = table_list.get(type);
		const table2 = type === 'path' ? 'locations' : 'objects';
		if (!(await query(`
			SELECT COUNT(*) AS valid FROM %I
			JOIN %I ON %I.id = %I.%I
			WHERE %I.game = %L AND %I.id = %L`,
			[table, table2, table2, table,
				obj_column_map.get(type), table2, game, table, id])
		)[0].valid) throw 'Action does not match game';
	}

	function restrict(permission, level) {
		if (!permission.length || permission[0].permission < level) {
			throw 'Unauthorized action';
		}
	}

	async function handle_effects({ states, moved_objects, inventory }, effects) {
		for (const effect of effects) {
			if (effect.state) {
				states[effect.should_be_there ? 'add' : 'delete'](effect.state);
			}
			if (effect.loc_obj) {
				if ((await query(`
						SELECT location FROM objects WHERE id = %L`,
						[effect.loc_obj]))[0].location === effect.location) {
					moved_objects.delete(effect.loc_obj);
				} else moved_objects.set(effect.loc_obj, effect.location);
				inventory.delete(effect.loc_obj);
			}
			if (effect.inv_obj) {
				inventory.add(effect.inv_obj);
				moved_objects.delete(effect.inv_obj);
			}
		}
	}
 
	async function satisfy_constraints({ states, moved_objects, inventory }, constraints) {
		let current_ID,
			valid = null;
		for (const constraint of constraints) {
			if (constraint.id !== current_ID) {
				if (valid) return valid;
				valid = constraint;
				current_ID = constraint.id;
			}
			if (valid && (
				(constraint.state &&
					(constraint.should_be_there ? !states.has(constraint.state) :
					states.size && (await query(`
						SELECT true FROM constraint_and_effect
						WHERE (obj = %L OR loc = %L) AND id IN (%L) LIMIT 1`,
						[constraint.obj, constraint.loc, [...states]]))[0]?.bool)
				) ||
				(constraint.loc_obj &&
					(moved_objects.get(constraint.loc_obj) ?? (await query(`
						SELECT location FROM objects WHERE id = %L`,
						[constraint.loc_obj]))[0].location)
					!== constraint.location
				) ||
				(constraint.inv_obj &&
					constraint.have_it !== inventory.has(constraint.inv_obj)
				)
			)) valid = null;
		}
		return valid;
	}

	async function show(data, text) {
		const token = jwt.sign({
			data: [
				[...data.states],
				+data.location,
				[...data.inventory],
				[...data.moved_objects.keys()],
				[...data.moved_objects.values()]
			],
			moves: data.moves + 1
		}, jwtKey);
		return await show_file('play.html',
			sanitize(data.game),
			await navbar(data.userid),
			await describe(data),
			show_newlines(sanitize(text)),
			token, data.inventory.size ?
				sanitize((await query(`
					SELECT name FROM objects WHERE id in (%L)`,
					[[...data.inventory]])).reduce(
						(acc, cur, index) => acc + (index ? ', ' : '') + cur.name, 'You have: '))
				: '',
			data.gameid, data.gameid);
	}

	async function win_lose({ game, gameid, moves, userid }, { text, win }) {
		return await show_file('win.html',
			sanitize(game),
			await navbar(userid),
			sanitize(text),
			win ? 'win!' : 'lose.', moves + 1,
			encodeURIComponent(gameid));
	}

	const describe = async data =>
		show_newlines(sanitize(await (await get_description_constraint_array(data.location))
			.reduce(async (acc, cur) =>
				await acc + ((await satisfy_constraints(data, cur))?.text ?? ''), '')));

	async function get_description_constraint_array(location) {
		const chunks = await query(`
			SELECT constraint_and_effect.obj,
				constraint_and_effect.loc,
				constraint_and_effect.id AS state,
				constraint_and_effect.name IS NOT NULL AS should_be_there,
				constraint_and_effect.name,
				location_constraint_and_effect.obj AS loc_obj,
				location_constraint_and_effect.location,
				description_to_inventory_constraint.obj AS inv_obj,
				description_to_inventory_constraint.have_it,
				descriptions.id,
				descriptions.num,
				descriptions.text FROM descriptions
			LEFT JOIN description_to_constraint
				ON descriptions.id = description_to_constraint.description
			LEFT JOIN constraint_and_effect
				ON constraint_and_effect.id = description_to_constraint.constraint_
			LEFT JOIN description_to_location_constraint
				ON descriptions.id = description_to_location_constraint.description
			LEFT JOIN location_constraint_and_effect
				ON location_constraint_and_effect.id =
					description_to_location_constraint.constraint_
			LEFT JOIN description_to_inventory_constraint
				ON descriptions.id = description_to_inventory_constraint.description
			WHERE descriptions.location = %L
			ORDER BY descriptions.num`, [location]);
		let constraint_array = [];
		let last_num;
		for (const chunk of chunks) {
			if (last_num === chunk.num) {
				constraint_array[constraint_array.length - 1].push(chunk);
			} else {
				constraint_array.push([chunk]);
				last_num = chunk.num;
			}
		}
		return constraint_array;
	}

	async function show_file(path, ...args) {
		return util.format(await files.get(path), ...args);
	}

	async function navbar(is_signed_in) {
		return await show_file(`navbar-sign-${is_signed_in ? 'out' : 'in'}.html`);
	}

	function sanitize(str) {
		return String(str)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#x27;')
			.replace(/\\/g, '&#x2F;');
	}

	function show_newlines(str) {
		return String(str).replace(/\n/g, '<br>');
	}

	function a_an(string) {
		return /^[aeiou]/i.test(string) ? `an ${string}` : `a ${string}`;
	}

	const jwtKey = process.env.SECRET_KEY;
	const expire_seconds = 60 * 60 * 24 * 100;

	function create_token(res, id) {
		const token = jwt.sign({ id }, jwtKey, {
			algorithm: 'HS256',
			expiresIn: expire_seconds,
		});
		res.setHeader('Set-Cookie', cookie.serialize('token', token, {
			maxAge: expire_seconds,
			httpOnly: true,
			sameSite: 'lax',
			secure: process.env.NODE_ENV === 'production'
		}));
	}
}