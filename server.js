'use strict';

const cluster = require('cluster');

if (process.env.NODE_ENV !== 'production') {
	require('dotenv').config();
}

if (cluster.isMaster) {
	for (let i = 0; i < (process.env.WEB_CONCURRENCY || 1); i++) cluster.fork();
} else {
	const http = require('http'),
		url = require('url'),
		fs = require('fs'),
		util = require('util'),
		crypto = require('crypto'),
		jwt = require('jsonwebtoken'),
		cookie = require('cookie'),
		pg = require('pg'),
		pg_format = require('pg-format'),
		port = +process.env.PORT || 80;

	const client = new pg.Client({
		connectionString: process.env.DATABASE_URL
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
		['pick_up_action', 'grab'],
		['path', 'paths'],
		['description', 'descriptions']]
	), start_table_list = new StrictMap([
		['action', 'action_to_'],
		['pick_up_action', 'grab_to_'],
		['path', 'path_to_'],
		['description', 'description_to_']
	]), column_list = new StrictMap([
		['action', 'action'],
		['pick_up_action', 'grab'],
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
				const parsed_url = url.parse(req.url, true);
				if (req.method === 'GET') {
					res.end(await get(parsed_url.pathname, parsed_url.query, userid, res));
				} else if (req.method === 'POST') {
					let data = '?';
					req.on('data', chunk => data += chunk);
					await new Promise(resolve => req.on('end', resolve));
					res.end(await post(parsed_url.pathname,
						url.parse(data, true).query, userid, res));
				} else if (req.method === 'DELETE') {
					if (parsed_url.pathname === '/remove') {
						await remove(parsed_url.query, userid, res);
					} else res.statusCode = 404;
				} else res.statusCode = 405;
			} catch (error) {
				if (error === "Unauthorized action") {
					res.statusCode = 401;
					if (req.method === "GET" && !userid) {
						res.end(await show_file('sign-in.html', await navbar(userid),
							sanitize(req.url), 'hidden', sanitize(req.url)));
					}
				} else res.statusCode = 400;
				console.error(error);
			} finally {
				if (!res.writableEnded) res.end();
			}
		}).listen(port, () => console.log('Server running at port %d', port)));

	async function get(path, data, userid, res) {
		let permission;
		if (data.game) {
			permission = await query(`
				SELECT permission FROM user_to_game
				WHERE user_ = %L AND game = %L`,
				[userid, data.game]);
		}
		switch (path) {
			case '/play': {
				const { data: [
					object_list, state_list,
					locationID, inventory_list,
					moved_object_list, location_list], moves
				} = jwt.verify(data.gameState, jwtKey),
					command = data.cmd.toLowerCase(),
					[{ game: gameid }] = await query(`
						SELECT game FROM locations
						WHERE id = %L`, [locationID]),
					game = await query(`
						SELECT public, name FROM games
						WHERE id = %L`, [gameid]),
					states = new Map(),
					moved_objects = new Map(),
					inventory = new Set(inventory_list);
				for (let i = 0; i < object_list.length; i++) {
					states.set(object_list[i], state_list[i]);
				}
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
				const objects = await query(`
						SELECT * FROM objects
						WHERE game = %L ORDER BY id`, [gameid]),
					show_data = {
						game: game[0].name, states, moved_objects, gameid,
						location: locationID, inventory, moves, objects, userid
					};
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
								constraint_and_effect.obj,
								constraint_and_effect.state,
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
						const result = satisfy_constraints(
							states, moved_objects, inventory, constraints, objects);
						if (result) {
							if (result.win === null) {
								const effects = await query(`
									SELECT constraint_and_effect.obj,
										constraint_and_effect.state,
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
								handle_effects(
									effects, objects, states, moved_objects, inventory);
								show_data.location = end_location[0].id;
								return await show(show_data, result.text);
							} else return await win_lose(show_data, result);
						} else return await show(show_data, 'Nothing happens.');
					} else return await show(show_data, 'Nothing happens.');
				} else if (split_pick_up = command.match(/^(?:pick up|grab|get) (.+)$/)) {
					const obj = await query(`
						SELECT id FROM objects
						WHERE name = %L AND game = %L AND location = %L;`,
						[split_pick_up[1], gameid, locationID]);
					if (obj.length === 1) {
						if (inventory.has(obj_index(objects, obj[0].id))) {
							return await show(show_data, "You already have it.");
						} else {
							const constraints = await query(`
								SELECT grab.id, grab.text, grab.success, grab.win,
									constraint_and_effect.obj,
									constraint_and_effect.state,
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
							const result = satisfy_constraints(
								states, moved_objects, inventory, constraints, objects);
							if (result) {
								if (result.win === null) {
									const effects = await query(`
										SELECT constraint_and_effect.obj,
											constraint_and_effect.state,
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
									handle_effects(
										effects, objects, states, moved_objects, inventory);
									if (result.success) {
										inventory.add(objects.findIndex(
											object => object.id === obj[0].id));
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
						if (item1.length === 1 && inventory.has(
							obj_index(objects, item1[0].id))) {
							return await use_on(item1[0].id, split_use[2]);
						} else return await show(show_data,
							`You don't have ${a_an(split_use[1])}`);
					}
					async function use_on(first_ID, second_name) {
						const item2 = await query(`
							SELECT id, location FROM objects
							WHERE name = %L`, [second_name]);
						let valid_items = [];
						for (const item of item2) {
							if (item.location == locationID ||
								inventory.has(item.id)) {
								valid_items.push(item);
							}
						}
						if (valid_items.length === 1) {
							const constraints = await query(`
								SELECT actions.id, actions.text, actions.win,
									constraint_and_effect.obj,
									constraint_and_effect.state,
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
								WHERE actions.obj1 = %L AND actions.obj2 = %L
								ORDER BY actions.id;`, [first_ID, item2[0].id]);
							const result = satisfy_constraints(
								states, moved_objects, inventory, constraints, objects);
							if (result) {
								if (result.win === null) {
									const effects = await query(`
										SELECT constraint_and_effect.obj,
											constraint_and_effect.state,
											location_constraint_and_effect.obj AS loc_obj,
											location_constraint_and_effect.location,
											action_to_inventory_effect.obj AS inv_obj
										FROM actions
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
										WHERE actions.id = %L;`, [result.id]);
									handle_effects(
										effects, objects, states, moved_objects, inventory);
									return await show(show_data,
										result.text ? result.text : "Nothing happens.");
								} else return await win_lose(show_data, result);
							} else return await show(show_data, "Nothing happens.");
						} else return await show(show_data, "Nothing happens.");
					}
				} else return await show(show_data, "Invalid command");
			} case '/': {
				const publics = await query(`
					SELECT id, name FROM games
					WHERE start IS NOT NULL AND public = TRUE
					ORDER BY name`);
				let public_game_list = "";
				for (const game of publics) {
					public_game_list += await show_file('start-game-link.html',
						encodeURIComponent(game.id), sanitize(game.name));
				}
				let private_game_list = "";
				if (userid) {
					const privates = await query(`
						SELECT games.id, games.name FROM games
						JOIN user_to_game ON user_to_game.game = games.id
						WHERE games.start IS NOT NULL
							AND games.public = FALSE
							AND user_to_game.user_ = %L
						ORDER BY games.name`, [userid]);
					for (const game of privates) {
						private_game_list += await show_file('start-game-link.html',
							encodeURIComponent(game.id), sanitize(game.name));
					}
				}
				return await show_file('home-page.html',
					await navbar(userid),	public_game_list, private_game_list);
			} case '/start': {
				const game = data.game;
				const result = await query(`
					SELECT locations.id, games.text, games.public, games.name FROM games
					JOIN locations ON locations.id = games.start
					WHERE games.id = %L`, [game]);
				if (!result[0].public) restrict(permission, 0);
				const list = Array(5).fill([]);
				list[2] = result[0].id;
				return await show_file('play.html',
					sanitize(result[0].name),
					await navbar(userid),
					show_newlines(sanitize(result[0].text)),
					await describe({
						location: result[0].id,
						states: new Map(),
						moved_objects: new Map(),
						inventory: new Set(),
						objects: []
					}),
					jwt.sign({ data: list, moves: 0 }, jwtKey),
					"", encodeURIComponent(game));
			} case '/edit':
				if (data.game) {
					const game = await query(`
						SELECT start, name, text FROM games
						WHERE id = %L`, [data.game]),
						permission = await query(`
						SELECT permission FROM user_to_game
						WHERE user_ = %L AND game = %L`, [userid, data.game]);
					restrict(permission, 1);
					const locations = await query(`
						SELECT id, name FROM locations WHERE game = %L`, [data.game]);
					let location_list = "";
					for (const location of locations) {
						if (game[0].start === location.id) {
							location_list += await show_file('location.html',
								location.id, ' class="start"',
								sanitize(location.name), "hidden");
						} else {
							location_list += await show_file('location.html',
								location.id, "",
								sanitize(location.name), "");
						}
					}
					const objects = await query(`
						SELECT * FROM objects
						WHERE location IS NULL AND game = %L`, [data.game]);
					let obj_list = '';
					for (const obj of objects) {
						obj_list += await show_file('object.html',
							obj.id, sanitize(obj.name));
					}
					let operator_controls = '';
					if (permission[0].permission >= 2) {
						const users = await query(`
							SELECT users.username, user_to_game.permission, users.id
							FROM user_to_game JOIN users
							ON user_to_game.user_ = users.id
							WHERE user_to_game.game = %L
							AND users.id != %L`, [data.game, userid]);
						let list = '';
						for (const user of users) {
							let opts = ['', '', ''];
							opts[user.permission] = 'selected';
							list += await show_file('user.html',
								user.id, sanitize(user.username), ...opts);
						}
						operator_controls = await show_file('operator-controls.html', list);
					}
					const game_id = encodeURIComponent(data.game);
					return await show_file('edit.html',
						sanitize(game[0].name), await navbar(userid),
						sanitize(game[0].text), location_list, obj_list,
						game_id, operator_controls, game_id);
				} else {
					if (!userid) throw "Unauthorized action";
					const result = await query(`
						SELECT games.id, games.name FROM games
						JOIN user_to_game ON user_to_game.game = games.id
						WHERE user_to_game.user_ = %L AND user_to_game.permission >= 1
						ORDER BY games.name`, [userid]);
					if (result.length) {
						let game_list = "";
						for (const { id, name } of result) {
							game_list += `<option value=${id}>${sanitize(name)}</option>`;
						}
						return await show_file('choose-edit.html',
							await navbar(userid), game_list);
					} else {
						res.setHeader('Location', '/new');
						res.statusCode = 307;
					}
				}
				break;
			case '/new':
				if (!userid) throw "Unauthorized action";
				return await show_file('new-game.html', await navbar(userid));
			case '/signin':
				return await show_file('sign-in.html',
					await navbar(userid), '/', 'hidden', '/');
			case '/navbar.css':
				res.setHeader('Content-Type', 'text/css');
				return await show_file('navbar.css');
			case '/expand':
				restrict(permission, 1);
				switch (data.type) {
					case "location": {
						await location_match_game(data.id, data.game);
						let description = '';
						const objs = await get_objs(data.game);
						for (const item of await get_constraint_array(data.id)) {
							let constraints = '',
								location_constraints = '',
								inventory_constraints = '';
							for (const constraint of item) {
								if (constraint.obj) {
									constraints += await show_file(
										'constraint-or-effect.html',
										constraint.obj,
										await all_objects(objs, constraint.obj),
										'must be',
										constraint.state);
								}
								if (constraint.loc_obj) {
									location_constraints += await show_file(
										'location-constraint-or-effect.html',
										constraint.loc_obj,
										await all_objects(objs, constraint.loc_obj),
										'must be',
										await all_locations(
											data.game,
											constraint.location));
								}
								if (constraint.inv_obj) {
									inventory_constraints += await show_file(
										'inventory-constraint.html',
										constraint.inv_obj,
										constraint.have_it ? '' : ' selected',
										await all_objects(objs, constraint.inv_obj));
								}
							}
							description += await show_file(
								'description.html',
								item[0].id,
								constraints,
								location_constraints,
								inventory_constraints,
								sanitize(item[0].text));
						}

						const objects = await (await query(`
							SELECT name, id FROM objects
							WHERE location = %L AND game = %L`,
							[data.id, data.game]))
							.reduce(
								async (acc, obj) => await acc + await show_file(
									'object.html', obj.id, sanitize(obj.name)), ''
							);

						const paths = await (await query(`
							SELECT id, end_, win FROM paths
							WHERE start = %L`, [data.id]))
							.reduce(
								async (acc, path) => await acc + await show_file('path.html',
									path.id,
									await all_locations(
										data.game,
										data.id,
										path.end_),
									...get_win_lose_array(path)), ''
							);
						return await show_file('expanded-location.html',
							description, objects, paths);
					} case "object": {
						const [object, actions, grabs] = await Promise.all([
							query(`
								SELECT name FROM objects
								WHERE id = %L AND game = %L`,
								[data.id, data.game]),
							query(`
								SELECT id, obj2, win FROM actions
								WHERE obj1 = %L`, [data.id]),
							query(`
								SELECT id, success, win FROM grab
								WHERE grab.obj = %L`, [data.id])
						]);

						return await show_file('expanded-object.html',
							...await Promise.all([
								actions.reduce(
									async (acc, action) =>
										await acc + await show_file('action.html',
											action.id, sanitize(object[0].name),
											await all_objects(
												await get_objs(data.game),
												action.obj2),
											...get_win_lose_array(action)
										), ''),
								grabs.reduce(
									async (acc, grab) =>
										await acc + await show_file('pick-up-action.html',
											grab.id, sanitize(object[0].name),
											grab.success ? 'checked' : '',
											...get_win_lose_array(grab)
										), '')
							]));
					} case "action":
					case "pick_up_action":
					case "path": {
						await action_match_game(data.type, data.id, data.game);
						const table_part = start_table_list.get(data.type),
							column = column_list.get(data.type);
						const sql = `
							SELECT constraint_and_effect.obj,
								constraint_and_effect.state
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
									table, column, data.id
								];
							},
							[constraints,
								effects,
								location_constraints,
								location_effects,
								inventory_constraints,
								inventory_effects,
								text] = await Promise.all([
									query(sql, params('constraint')),
									query(sql, params('effect')),
									query(location_sql, params('location_constraint')),
									query(location_sql, params('location_effect')),
									query(`SELECT obj, have_it FROM %I WHERE %I = %L`,
										[table_part + 'inventory_constraint',
											column, data.id]),
									query(`SELECT obj FROM %I WHERE %I = %L`,
										[table_part + 'inventory_effect',
											column, data.id]),
									query(`SELECT text FROM %I WHERE id = %L`,
										[table_list.get(data.type), data.id])
								]);

						const objs = {
							get all() {
								delete objs.all;
								return objs.all = get_objs(data.game);
							}
						};

						return await show_file('expanded-action.html',
							sanitize(text[0].text),
							...await Promise.all([
								show_constraint_effect(constraints, true),
								show_constraint_effect(effects, false),
								show_location_constraint_effect(
									location_constraints, true),
								show_location_constraint_effect(
									location_effects, false),
								inventory_constraints.reduce(
									async (acc, item) => await acc + await show_file(
										'inventory-constraint.html',
										item.obj, item.have_it ? '' : ' selected',
										await all_objects(await objs.all, item.obj)),
									''),
								inventory_effects.reduce(
									async (acc, item) => await acc + await show_file(
										'inventory-effect.html',
										item.obj,
										await all_objects(await objs.all, item.obj)),
									'')
							]));

						function show_constraint_effect(items, is_constraint) {
							return items.reduce(
								async (acc, item) =>
									await acc + await show_file('constraint-or-effect.html',
										item.obj,
										await all_objects(await objs.all, item.obj),
										is_constraint ? 'must be' : 'goes',
										item.state), '');
						}

						function show_location_constraint_effect(items, is_constraint) {
							return items.reduce(async (acc, item) =>
								await acc + await show_file(
									'location-constraint-or-effect.html',
									item.obj,
									await all_objects(await objs.all, item.obj),
									is_constraint ? 'must be' : 'goes',
									await all_locations(
										data.game,
										null, item.location
									)), '');
						}
					} default: res.statusCode = 400;
				}
				break;
			case '/check/username': {
				res.setHeader('Content-Type', 'text/plain');
				const taken = await query(`
					SELECT COUNT(*) AS num FROM %I
					WHERE %I = %L`, ['users', 'username', data.name]);
				return String(taken[0].num);
			} case '/description-constraint': {
				restrict(permission, 1);
				switch (data.type) {
					case 'constraint':
						return await show_file('constraint-or-effect.html',
							0, await all_objects(await get_objs(data.game)),
							'must be', 0);
					case 'location-constraint':
						return await show_file('location-constraint-or-effect.html',
							0, await all_objects(await get_objs(data.game)),
							'must be', await all_locations(data.game));
					case 'inventory-constraint':
						return await show_file('inventory-constraint.html',
							0, '',
							await all_objects(await get_objs(data.game)));
					default: res.statusCode = 404;
				}
				break;
			} case '/constraint-or-effect': {
				restrict(permission, 1);
				if (/^location-/.test(data.type)) {
					return await show_file('location-constraint-or-effect.html',
						0, await all_objects(await get_objs(data.game)),
						data.type === 'location-constraint' ?
							'must be' : 'goes',
						await all_locations(data.game));
				} else if (data.type === 'inventory-constraint') {
					return await show_file('inventory-constraint.html',
						0, "", await all_objects(await get_objs(data.game)));
				} else if (data.type === 'inventory-effect') {
					return await show_file('inventory-effect.html',
						0, all_objects(await get_objs(data.game)));
				} else {
					return await show_file('constraint-or-effect.html',
						0, await all_objects(await get_objs(data.game)),
						data.type === 'constraint' ?
							'must be' : 'goes',
						0);
				}
			} case '/join-link': {
				restrict(permission, 2);
				res.setHeader('Content-Type', 'text/plain');
				return jwt.sign({
					id: Number(data.game)
				}, jwtKey, {
					expiresIn: '5 days'
				});
			} case '/join': {
				if (!userid) throw "Unauthorized action";
				const game = jwt.verify(data.token, jwtKey).id;
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
			} default: {
				res.statusCode = 404;
				return await show_file('404.html');
			}
		}
	}


	async function post(path, data, userid, res) {
		const permission = await query(`
			SELECT permission FROM user_to_game
			WHERE user_ = %L AND game = %L`,
			[userid, data.game]);
		switch (path) {
			case '/create': {
				if (!userid) throw 'Unauthorized action';
				const game = await query(`
					INSERT INTO games (name, text) VALUES (%L, '') RETURNING id`,
					[data.name]);
				await query(`
					INSERT INTO user_to_game (user_, game, permission)
					VALUES (%L, %L, 2)`, [userid, game[0].id]);
				res.setHeader('content-type', 'text/plain');
				return String(game[0].id);
			} case '/signin': {
				const user = await query(`
					SELECT id FROM users WHERE username = %L AND hash = %L`,
					[data.username, crypto.createHash('sha256')
						.update(data.password).digest('hex')]);
				if (user.length) {
					create_token(res, user[0].id);
					res.setHeader('Location', data.url);
					res.statusCode = 303;
				} else {
					res.statusCode = 401;
					return await show_file('sign-in.html',
						await navbar(userid), data.url, '', data.url);
				}
				break;
			} case '/signup': {
				const hash = crypto.createHash('sha256')
					.update(data.password)
					.digest('hex');
				const [{ id }] = await query(`
					INSERT INTO users (username, hash) VALUES (%L, %L)
					RETURNING id`,
					[data.username, hash]);
				create_token(res, id);
				res.setHeader('Location', data.url);
				res.statusCode = 303;
				break;
			} case '/signout': {
				res.setHeader('Set-Cookie', cookie.serialize('token', '', { maxAge: 0 }));
				res.setHeader('Location', '/');
				res.statusCode = 303;
				break;
			} case '/add': {
				restrict(permission, 1);
				switch (data.type) {
					case "location": {
						const name = data.name.toLowerCase();
						const result = await query(`
							INSERT INTO locations (game, name)
							VALUES (%L,%L) RETURNING id`,
							[data.game, name]);
						return await show_file('location.html',
							result[0].id, "",
							sanitize(name), "");
					} case "object": {
						const is_anywhere = !isNaN(data.location);
						if (is_anywhere) {
							await location_match_game(data.location, data.game);
						}
						const result = await query(`
							INSERT INTO objects (game, name, location)
							VALUES (%L,%L,%L) RETURNING id`,
							[data.game, data.name.toLowerCase(),
							is_anywhere ? data.location : null]);
						return await show_file('object.html',
							result[0].id, sanitize(data.name.toLowerCase()));
					} case "action": {
						await object_match_game(data.item, data.game);
						const result = await query(`
							INSERT INTO actions (obj1) VALUES (%L) RETURNING id`,
							[data.item]);
						const name = await query(`
							SELECT name FROM objects WHERE id = %L`, [data.item]);
						return await show_file('action.html',
							result[0].id, sanitize(name[0].name),
							await all_objects(await get_objs(data.game)),
							...get_win_lose_array({ id: result[0].id, win: null }));
					} case "pick_up_action": {
						await object_match_game(data.item, data.game);
						const result = await query(`
							INSERT INTO grab (obj) VALUES (%L) RETURNING id`,
							[data.item]);
						const name = await query(`
							SELECT name FROM objects WHERE id = %L`, [data.item]);
						return await show_file('pick-up-action.html',
							result[0].id, sanitize(name[0].name), 'checked',
							...get_win_lose_array({ id: result[0].id, win: null }));
					} case "path": {
						await location_match_game(data.item, data.game);
						const result = await query(`
							INSERT INTO paths (start) VALUES (%L) RETURNING id`,
							[data.item]);
						return await show_file('path.html', result[0].id,
							await all_locations(data.game, data.item),
							...get_win_lose_array({ id: result[0].id, win: null }));
					} case "description": {
						await location_match_game(data.item, data.game);
						await query(`
							UPDATE descriptions
							SET num = num + 1
							WHERE location = %L AND num >= %L`,
							[data.item, data.num]);
						const description = await query(`
							INSERT INTO descriptions (location, num, text)
							VALUES (%L, %L, '') RETURNING id`, [data.item, data.num]);
						return await show_file('description.html',
							description[0].id, '', '', '', '');
					} default: {
						await object_match_game(data.obj, data.game);
						await action_match_game(data.parenttype, data.item, data.game);
						const [, type1, type2] = data.type.match(
							/^(location-|inventory-)?(constraint|effect)$/);
						const select_params = [data.obj, data.value];
						let id, table;
						if (!type1) {
							table = start_table_list.get(data.parenttype) + type2;
							const exists = await query(`
								SELECT id FROM constraint_and_effect
								WHERE obj = %L AND state = %L`, select_params);
							id = exists.length ? exists[0].id : (await query(`
								INSERT INTO constraint_and_effect (obj, state)
								VALUES (%L, %L) RETURNING id`, select_params))[0].id;
						} else if (type1 === 'location-') {
							await location_match_game(data.value, data.game);
							const exists = await query(`
								SELECT id FROM location_constraint_and_effect
								WHERE obj = %L AND location = %L`, select_params);
							id = exists.length ? exists[0].id : (await query(`
								INSERT INTO location_constraint_and_effect
									(obj, location)
								VALUES (%L, %L) RETURNING id`, select_params))[0].id;
							table = start_table_list.get(data.type) +
								'location' + type2;
						} else if (type1 === 'inventory-') {
							const table = start_table_list.get(data.parenttype) +
								'inventory_' + type2;
							if (type2 === 'constraint') {
								await query(`
									INSERT INTO %I (%I, obj, have_it)
									VALUES (%L, %L, %L)`,
									[table, column_list.get(data.parenttype),
										data.item, data.obj,
										Number(data.value) ? 1 : 0]);
							} else {
								await query(`
									INSERT INTO %I (%L, obj) VALUES (%L, %L)`,
									[table, column_list.get(data.parenttype),
										data.item, data.obj]);
							}
							break;
						}
						await query(`
							INSERT INTO %I (%I, %I) VALUES (%L, %L)`,
							[table,
								column_list.get(data.parenttype),
								type2 === 'constraint' ? 'constraint_' : 'effect',
								data.item, id]);
					}
				}
				break;
			} case '/setstart': {
				restrict(permission, 1);
				await query(`
					UPDATE games SET start = %L
					WHERE id = %L`, [data.id, data.game]);
				res.statusCode = 204;
				break;
			} case '/rename': {
				restrict(permission, 1);
				let table;
				if (data.type === 'location') {
					await location_match_game(data.id, data.game);
					table = 'locations';
				} else if (data.type === 'object') {
					await object_match_game(data.id, data.game);
					table = 'objects';
				} else throw "Invalid type";
				await query(`UPDATE %I SET name = %L WHERE id = %L`,
					[table, data.name.toLowerCase(), data.id]);
				res.statusCode = 204;
				break;
			} case '/change/start-text': {
				restrict(permission, 1);
				await query(`
					UPDATE games SET text = %L
					WHERE id = %L`, [data.text, data.game]);
				break;
			} case '/change/description': {
				restrict(permission, 1);
				if (data.type === 'location') {
					const valid = await query(`
						SELECT COUNT(*) AS valid FROM locations
						JOIN descriptions ON descriptions.location = locations.id
						WHERE locations.game = %L AND descriptions.id = %L`,
						[data.game, data.id]);
					if (!valid[0].valid) throw 'description does not match game';
					await query(`
						UPDATE descriptions SET text = %L
						WHERE id = %L`,
						[data.text, data.id]);
				} else {
					await action_match_game(data.type, data.id, data.game);
					await query(`
						UPDATE %I SET text = %L
						WHERE id = %L`,
						[table_list.get(data.type), data.text, data.id]);
				}
				res.statusCode = 204;
				break;
			} case '/change/item': {
				restrict(permission, 1);
				await action_match_game(data.type, data.id, data.game);
				if (data.type === 'action') {
					await query(`
						UPDATE actions SET obj2 = %L
						WHERE id = %L`, [data.newitem, data.id]);
				} else if (data.type === 'path') {
					await query(`
						UPDATE paths SET end_ = %L
						WHERE id = %L`, [data.newitem, data.id]);
				} else if (data.type === 'pick_up_action') {
					await query(`
						UPDATE grab SET success = %L
						WHERE id = %L`, [data.state, data.id]);
				}
				res.statusCode = 204;
				break;
			} case '/change/win': {
				restrict(permission, 1);
				await action_match_game(data.type, data.id, data.game);
				await query(`
					UPDATE %I SET win = %L
					WHERE id = %L`,
					[table_list.get(data.type), win_value_list.get(data.value), data.id]);
				res.statusCode = 204;
				break;
			} case '/change/permission': {
				restrict(permission, 2);
				if (data.permission === '-1') {
					await query(`
						DELETE FROM user_to_game
						WHERE user_ = %L AND game = %L`,
						[data.user, data.game]);
				} else if (['0', '1', '2'].includes(data.permission)) {
					await query(`
						UPDATE user_to_game
						SET permission = %L
						WHERE user_ = %L AND game = %L`,
						[data.permission, data.user, data.game]);
				}
				break;
			} default: res.statusCode = 404;
		}
	}


	async function remove(data, userid, res) {
		const permission = await query(`
			SELECT permission FROM user_to_game
			WHERE user_ = %L AND game = %L`,
			[userid, data.game]);
		res.statusCode = 204;
		restrict(permission, 1);
		switch (data.type) {
			case "game":
				restrict(permission, 2);
				await query(`
					DELETE FROM games
					WHERE id = %L`, [data.game]);
				break;
			case "location":
				await query(`
					DELETE FROM locations
					WHERE id = %L AND game = %L`,
					[data.id, data.game]);
				break;
			case "object":
				await query(`
					DELETE FROM objects
					WHERE id = %L AND game = %L`,
					[data.id, data.game]);
				break;
			case "action":
			case "pick_up_action":
			case "path":
				await action_match_game(data.type, data.id, data.game);
				await query(`
					DELETE FROM %I WHERE id = %L`,
					[table_list.get(data.type), data.id]);
				break;
			case "description":
				await location_match_game(
					data.item, data.game);
				await query(`
					DELETE FROM descriptions
					WHERE location = %L AND num = %L`,
					[data.item, data.num]);
				await query(`
					UPDATE descriptions
					SET num = num - 1
					WHERE location = %L AND num > %L`,
					[data.item, data.num]);
				break;
			default: {
				await object_match_game(data.obj, data.game);
				if (data.parenttype === 'description') {
					const valid = await query(`
						SELECT COUNT(*) AS valid FROM descriptions
						JOIN locations ON descriptions.location = locations.id
						WHERE descriptions.id = %L AND locations.game = %L`,
						[data.item, data.game]);
					if (!valid[0].valid) throw "Action does not match game";
				} else await action_match_game(
					data.parenttype, data.item,
					data.game);
				const [, type1, type2] = data.type.match(
					/^(location-|inventory-)?(constraint|effect)$/);
				if (type1 === 'inventory-') {
					await query(`
						DELETE FROM %I WHERE obj = %L AND %I = %L`,
						[start_table_list.get(data.parenttype) +
							'inventory_' + type2,
						data.obj,
						column_list.get(data.parenttype),
						data.item]);
				} else {
					const table1 = start_table_list.get(data.parenttype) +
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
							table2, table1, column_list.get(data.parenttype),
							data.item, table2, data.obj]);
				}
			}
		}
	}


	function obj_index(objects, id) {
		return objects.findIndex(obj => obj.id === id);
	}

	async function location_match_game(location, game) {
		const valid = await query(`
			SELECT COUNT(*) AS valid FROM locations
			WHERE id = %L AND game = %L`, [location, game]);
		if (!valid[0].valid) throw "location does not match game";
	}

	async function object_match_game(object, game) {
		const valid = await query(`
			SELECT COUNT(*) AS valid FROM objects
			WHERE id = %L AND game = %L`, [object, game]);
		if (!valid[0].valid) throw "object does not match game";
	}

	const obj_column_map = new StrictMap([
		['action', 'obj1'], ['pick_up_action', 'obj'], ['path', 'start'], ['description', 'location']
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
		)[0].valid) throw "Action does not match game";
	}

	function restrict(permission, level) {
		if (!permission.length || permission[0].permission < level) {
			throw "Unauthorized action";
		}
	}

	function handle_effects(effects, objects, states, moved_objects, inventory) {
		for (const effect of effects) {
			if (effect.obj) {
				states.set(obj_index(objects, effect.obj), effect.state);
			}
			if (effect.loc_obj) {
				const index = obj_index(objects, effect.inv_obj);
				moved_objects.set(index, effect.location);
				inventory.delete(index);
			}
			if (effect.inv_obj) {
				const index = obj_index(objects, effect.inv_obj);
				inventory.add(index);
				moved_objects.delete(index);
			}
		}
	}

	function satisfy_constraints(states, moved_objects, inventory, constraints, objects) {
		let current_ID,
			valid = false;
		for (const constraint of constraints) {
			if (constraint.id !== current_ID) {
				if (valid) return valid;
				valid = constraint;
				current_ID = constraint.id;
			}
			if (valid && (
				(constraint.obj &&
					(states.get(obj_index(objects, constraint.obj)) || 0)
					!== constraint.state
				) ||
				(constraint.loc_obj &&
					(moved_objects.get(obj_index(objects, constraint.loc_obj)) || 0)
					!== constraint.location
				) ||
				(constraint.inv_obj &&
					constraint.have_it != inventory.has(
						obj_index(objects, constraint.inv_obj))
				)
			)) valid = false;
		}
		return valid;
	}

	async function show(data, text) {
		const token = jwt.sign({
			data: [
				Array.from(data.states.keys()),
				Array.from(data.states.values()),
				parseInt(data.location),
				Array.from(data.inventory),
				Array.from(data.moved_objects.keys()),
				Array.from(data.moved_objects.values())
			],
			moves: data.moves + 1
		}, jwtKey);
		return await show_file('play.html',
			sanitize(data.game),
			await navbar(data.userid),
			await describe(data),
			show_newlines(sanitize(text)),
			token, data.inventory.size ?
			`You have: ${sanitize(Array.from(data.inventory, i => data.objects[i].name).join(', '))
			}` : "",
			encodeURIComponent(data.gameid));
	}

	async function win_lose({ game, gameid, moves, userid }, { text, win }) {
		return await show_file('win.html',
			sanitize(game),
			await navbar(userid),
			sanitize(text),
			win ? 'win!' : 'lose.', moves + 1,
			encodeURIComponent(gameid));
	}

	async function describe(data) {
		let description = "";
		for (const item of await get_constraint_array(data.location)) {
			description += satisfy_constraints(
				data.states, data.moved_objects, data.inventory,
				item, data.objects).text || "";
		}
		return show_newlines(sanitize(description));
	}

	async function get_constraint_array(location) {
		const chunks = await query(`
			SELECT constraint_and_effect.obj,
				constraint_and_effect.state,
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

	function get_win_lose_array({ win, id }) {
		return [
			id, win === null ? 'checked' : '',
			id, win === 1 ? 'checked' : '',
			id, win === 0 ? 'checked' : ''];
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
			.replace(/'/g, '&#x27')
			.replace(/\\/g, '&#x2F');
	}

	function show_newlines(str) {
		return String(str).replace(/\n/g, '<br>');
	}

	async function get_objs(game) {
		return await query(`
			SELECT id, name FROM objects
			WHERE game = %L ORDER BY location`, [game]);
	}

	async function all_objects(objs, id) {
		const options = objs.map(elem =>
			`<option value="${elem.id}" ${id === elem.id ? 'selected' : ''}>${
			sanitize(elem.name)}</option>`);
		return `<option></option>` + options.join('');
	}
	async function all_locations(game, no, id) {
		const locations = await query(`
			SELECT * FROM locations WHERE game = %L`, [game]);
		const options = locations.map(elem => elem.id === no ? '' :
			`<option value="${elem.id}" ${id === elem.id ? 'selected' : ''}>${
			sanitize(elem.name)}</option>`);
		return `<option></option>` + options.join('');
	}

	function a_an(string) {
		return /^[aeiou]/i.test(string) ? `an ${string}` : `a ${string}`;
	}

	const jwtKey = process.env.SECRET_KEY;
	const expire_seconds = 60 * 60 * 12;

	function create_token(res, id) {
		const token = jwt.sign({ id }, jwtKey, {
			algorithm: "HS256",
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