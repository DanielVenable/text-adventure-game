'use strict';

const cluster = require('cluster');

if (cluster.isMaster) {
	for (let i = 0; i < require('os').cpus().length; i++) cluster.fork();
	cluster.on('disconnect', cluster.fork);
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
		connectionString: process.env.DATABASE_URL,
		ssl: {
			rejectUnauthorized: false
		}
	});

	function query(str, arr) {
		return client.query(pg_format(str, ...arr));
	}

	process.chdir(__dirname + '/files');

	class StrictMap extends Map {
		get (key) {
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
			['path', 'paths']]
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
			try {
				let userid;
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
					if (req.method === "GET") {
						res.end(await show_file('sign-in.html',
							sanitize(req.url), 'hidden', sanitize(req.url)));
					}
				} else await invalid_request(res);
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
						WHERE ID = %L`, [locationID]),
					game = await query(`
						SELECT public, name FROM games
						WHERE ID = %L`, [gameid]),
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
						WHERE game = %L ORDER BY ID`, [gameid]),
					show_data = {
						game: game[0].name, states, moved_objects,
						location: locationID, inventory, moves, objects
					};
				let split_go_to,
					split_pick_up,
					split_use;
				if (split_go_to = command.match(/^go (?:to )?(.+)$/)) {
					const end_location = await query(`
						SELECT ID FROM locations
						WHERE name = %L AND game = %L`,
						[split_go_to[1], gameid]);
					if (end_location.length === 1) {
						const constraints = await query(`
							SELECT paths.ID, paths.text, paths.win,
								constraint_and_effect.obj,
								constraint_and_effect.state,
								location_constraint_and_effect.obj AS loc_obj,
								location_constraint_and_effect.location,
								path_to_inventory_constraint.obj AS inv_obj,
								path_to_inventory_constraint.have_it FROM paths
							LEFT JOIN path_to_constraint
								ON paths.ID = path_to_constraint.path
							LEFT JOIN constraint_and_effect
								ON constraint_and_effect.ID =
									path_to_constraint.constraint_
							LEFT JOIN path_to_location_constraint
								ON paths.ID = path_to_location_constraint.path
							LEFT JOIN location_constraint_and_effect
								ON location_constraint_and_effect.ID =
									path_to_location_constraint.constraint_
							LEFT JOIN path_to_inventory_constraint
								ON paths.ID = path_to_inventory_constraint.path
							WHERE paths.start = %L AND paths.end_ = %L
							ORDER BY paths.ID;`,
							[locationID, end_location[0].ID]);
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
										ON paths.ID = path_to_effect.path
									LEFT JOIN constraint_and_effect
										ON constraint_and_effect.ID =
											path_to_effect.effect
									LEFT JOIN path_to_location_effect
										ON paths.ID = path_to_location_effect.path
									LEFT JOIN location_constraint_and_effect
										ON location_constraint_and_effect.ID =
											path_to_location_effect.effect
									LEFT JOIN path_to_inventory_effect
										ON paths.ID = path_to_inventory_effect.path
									WHERE paths.start = %L AND paths.end_ = %L`,
									[locationID, end_location[0].ID]);
								handle_effects(
									effects, objects, states, moved_objects, inventory);
								show_data.location = end_location[0].ID;
								return await show(show_data, result.text);
							} else return await win_lose(show_data, result);
						} else return await show(show_data, 'Nothing happens.');
					} else return await show(show_data, 'Nothing happens.');
				} else if (split_pick_up = command.match(/^(?:pick up|grab|get) (.+)$/)) {
					const obj = await query(`
						SELECT ID FROM objects
						WHERE name = %L AND game = %L AND location = %L;`,
						[split_pick_up[1], gameid, locationID]);
					if (obj.length === 1) {
						if (inventory.has(obj_index(objects, obj[0].ID))) {
							return await show(show_data, "You already have it.");
						} else {
							const constraints = await query(`
								SELECT grab.ID, grab.text, grab.success, grab.win,
									constraint_and_effect.obj,
									constraint_and_effect.state,
									location_constraint_and_effect.obj AS loc_obj,
									location_constraint_and_effect.location,
									grab_to_inventory_constraint.obj AS inv_obj,
									grab_to_inventory_constraint.have_it FROM grab
								LEFT JOIN grab_to_constraint
									ON grab.ID = grab_to_constraint.grab
								LEFT JOIN constraint_and_effect
									ON constraint_and_effect.ID =
										grab_to_constraint.constraint_
								LEFT JOIN grab_to_location_constraint
									ON grab.ID = grab_to_location_constraint.grab
								LEFT JOIN location_constraint_and_effect
									ON location_constraint_and_effect.ID =
										grab_to_location_constraint.constraint_
								LEFT JOIN grab_to_inventory_constraint
									ON grab.ID = grab_to_inventory_constraint.grab
								WHERE grab.obj = %L
								ORDER BY grab.ID`, [obj[0].ID]);
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
											ON grab.ID = grab_to_effect.grab
										LEFT JOIN constraint_and_effect
											ON constraint_and_effect.ID =
												grab_to_effect.effect
										LEFT JOIN grab_to_location_effect
											ON grab.ID = grab_to_location_effect.grab
										LEFT JOIN location_constraint_and_effect
											ON location_constraint_and_effect.ID =
												grab_to_location_effect.effect
										LEFT JOIN grab_to_inventory_effect
											ON grab.ID = grab_to_inventory_effect.grab
										WHERE grab.ID = %L`, [result.ID]);
									handle_effects(
										effects, objects, states, moved_objects, inventory);
									if (result.success) {
										inventory.add(objects.findIndex(
											object => object.ID === obj[0].ID));
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
							SELECT ID FROM objects
							WHERE name = %L`, [split_use[1]]);
						if (item1.length === 1 && inventory.has(
							obj_index(objects, item1[0].ID))) {
							return await use_on(item1[0].ID, split_use[2]);
						} else return await show(show_data,
							`You don't have ${a_an(split_use[1])}`);
					}
					async function use_on(first_ID, second_name) {
						const item2 = await query(`
							SELECT ID, location FROM objects
							WHERE name = %L`, [second_name]);
						let valid_items = [];
						for (const item of item2) {
							if (item.location == locationID ||
								inventory.has(item.ID)) {
								valid_items.push(item);
							}
						}
						if (valid_items.length === 1) {
							const constraints = await query(`
								SELECT actions.ID, actions.text, actions.win,
									constraint_and_effect.obj,
									constraint_and_effect.state,
									location_constraint_and_effect.obj AS loc_obj,
									location_constraint_and_effect.location,
									action_to_inventory_constraint.obj AS inv_obj,
									action_to_inventory_constraint.have_it FROM actions
								LEFT JOIN action_to_constraint
									ON actions.ID = action_to_constraint.action
								LEFT JOIN constraint_and_effect
									ON constraint_and_effect.ID =
										action_to_constraint.constraint_
								LEFT JOIN action_to_location_constraint
									ON actions.ID = action_to_location_constraint.action
								LEFT JOIN location_constraint_and_effect
									ON location_constraint_and_effect.ID =
										action_to_location_constraint.constraint_
								LEFT JOIN action_to_inventory_constraint
									ON actions.ID = action_to_inventory_constraint.action
								WHERE actions.obj1 = %L AND actions.obj2 = %L
								ORDER BY actions.ID;`, [first_ID, item2[0].ID]);
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
											ON actions.ID = action_to_effect.action
										LEFT JOIN constraint_and_effect
											ON constraint_and_effect.ID =
												action_to_effect.effect
										LEFT JOIN action_to_location_effect
											ON actions.ID = action_to_location_effect.action
										LEFT JOIN location_constraint_and_effect
											ON location_constraint_and_effect.ID =
												action_to_location_effect.effect
										LEFT JOIN action_to_inventory_effect
											ON actions.ID = action_to_inventory_effect.action
										WHERE actions.ID = %L;`, [result.ID]);
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
				const result = await query(`
					SELECT name FROM games
					WHERE start IS NOT NULL AND public = 1
					ORDER BY name`);
				let game_list = "";
				for (const game of result) {
					game_list += await show_file('start-game-link.html',
						encodeURIComponent(game.name), sanitize(game.name));
				}
				return await show_file('home-page.html', game_list);
			} case '/start': {
				const game = data.game;
				const result = await query(`
					SELECT locations.ID, games.text, games.public FROM games
					JOIN locations ON locations.ID = games.start
					WHERE games.name = %L`, [game]);
				if (!result[0].public)
					restrict(permission, 0);
				const list = Array(5).fill([]);
				list[2] = result[0].ID;
				return await show_file('play.html',
					sanitize(game),
					sanitize(result[0].text),
					await describe({
						location: result[0].ID,
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
						SELECT ID, start FROM games
						WHERE name = %L`, [data.game]),
						permission = await query(`
						SELECT permission FROM user_to_game
						WHERE user_ = %L AND game = %L`, [userid, game[0].ID]);
					restrict(permission, 1);
					const locations = await query(`
						SELECT ID, name FROM locations WHERE game = %L`, [game[0].ID]);
					let location_list = "";
					for (const location of locations) {
						if (game[0].start === location.ID) {
							location_list += await show_file('location.html',
								location.ID, ' data-type="start"',
								sanitize(location.name), "hidden");
						} else {
							location_list += await show_file('location.html',
								location.ID, "",
								sanitize(location.name), "");
						}
					}
					const objects = await query(`
						SELECT * FROM objects
						WHERE location IS NULL AND game = %L`, [game[0].ID]);
					let obj_list = '';
					for (const obj of objects) {
						obj_list += await show_file('object.html',
							obj.ID, sanitize(obj.name));
					}
					let operator_controls = '';
					if (permission[0].permission >= 2) {
						const users = await query(`
							SELECT users.username, user_to_game.permission, users.ID
							FROM user_to_game JOIN users
							ON user_to_game.user_ = users.ID
							WHERE user_to_game.game = %L
							AND users.ID != %L`, [game[0].ID, userid]);
						let list = '';
						for (const user of users) {
							let opts = ['', '', ''];
							opts[user.permission] = 'selected';
							list += await show_file('user.html',
								user.ID, sanitize(user.username), ...opts);
						}
						operator_controls = await show_file('operator-controls.html', list);
					}
					return await show_file('edit.html',
						location_list,
						obj_list,
						encodeURIComponent(data.game),
						operator_controls, game[0].ID);
				} else {
					if (!userid) throw "Unauthorized action";
					const result = await query(`
					SELECT games.name, games.ID FROM games
					JOIN user_to_game ON user_to_game.game = games.ID
					WHERE user_to_game.user_ = %L AND user_to_game.permission >= 1
					ORDER BY games.name`, [userid]);
					if (result.length) {
						let game_list = "";
						for (const game of result) {
							game_list += `<option>${sanitize(game.name)}</option>`;
						}
						return await show_file('choose-edit.html', game_list);
					} else {
						res.setHeader('Location', '/new');
						res.statusCode = 307;
					}
				}
				break;
			case '/new':
				return await show_file('new-game.html');
			case '/signin':
				return await show_file('sign-in.html', '/', 'hidden', '/');
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
								item[0].ID,
								constraints,
								location_constraints,
								inventory_constraints,
								sanitize(item[0].text));
						}

						const objects = await (await query(`
							SELECT name, ID FROM objects
							WHERE location = %L AND game = %L`,
							[data.id, data.game]))
							.reduce(
								async (acc, obj) => await acc + await show_file(
									'object.html', obj.ID, sanitize(obj.name)), ''
							);

						const paths = await (await query(`
							SELECT ID, end_, win FROM paths
							WHERE start = %L`, [data.id]))
							.reduce(
								async (acc, path) => await acc + await show_file('path.html',
									path.ID,
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
								WHERE ID = %L AND game = %L`,
								[data.id, data.game]),
							query(`
								SELECT ID, obj2, win FROM actions
								WHERE obj1 = %L`, [data.id]),
							query(`
								SELECT ID, success, win FROM grab
								WHERE grab.obj = %L`, [data.id])
						]);
						
						return await show_file('expanded-object.html',
							...await Promise.all([
								actions.reduce(
									async (acc, action) =>
										await acc + await show_file('action.html',
											action.ID, sanitize(object[0].name),
											await all_objects(
												await get_objs(data.game),
												action.obj2),
											...get_win_lose_array(action)
										), ''),
								grabs.reduce(
									async (acc, grab) =>
										await acc + await show_file('pick-up-action.html',
											grab.ID, sanitize(object[0].name),
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
							JOIN %I ON constraint_and_effect.ID = %I.%I
							WHERE %I.%I = %L`,
							location_sql = `
							SELECT location_constraint_and_effect.obj,
								location_constraint_and_effect.location
								FROM location_constraint_and_effect
							JOIN %I ON location_constraint_and_effect.ID = %I.%I
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
									query(`SELECT text FROM %I WHERE ID = %L`,
										[table_list.get(data.type),	data.id])
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
					} default: await invalid_request(res);
				}
				break;
			case '/check/game':
			case '/check/username': {
				res.setHeader('Content-Type', 'text/plain');
				const list = path === '/check/game' ?
					['games', 'name', data.name] :
					['users', 'username', data.name];
				const taken = await query(`
					SELECT COUNT(*) AS num FROM %I
					WHERE %I = %L`, list);
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
				res.setHeader('Content-Type', 'text/uri-list');
				return `http://localhost:${port}/join?token=${jwt.sign({
					id: Number(data.game)
				}, jwtKey, {
					expiresIn: '5 days'
				})}`;
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
				try {
					const game = await query(`
						INSERT INTO games (name) VALUES (%L)`, [data.name]);
					await query(`
						INSERT INTO user_to_game (user_, game, permission)
						VALUES (%L, %L, 2)`, [userid, game.insertId]);
					res.statusCode = 201;
				} catch {
					res.statusCode = 409;
				}
				break;
			} case '/signin': {
				const user = await query(`
					SELECT ID FROM users WHERE username = %L AND hash = %L`,
					[data.username, crypto.createHash('sha256')
						.update(data.password).digest('hex')]);
				if (user.length) {
					create_token(res, user[0].ID);
					res.setHeader('Location', data.url);
					res.statusCode = 303;
				} else {
					res.statusCode = 401;
					return await show_file('sign-in.html', data.url, '', data.url);
				}
				break;
			} case '/signup': {
				const hash = crypto.createHash('sha256')
					.update(data.password)
					.digest('hex');
				await query(`
					INSERT INTO users (username, hash) VALUES (%L, %L)`,
					[data.username, hash]);
				create_token(res, data.username);
				res.setHeader('Location', data.url);
				res.statusCode = 303;
				break;
			} case '/add': {
				restrict(permission, 1);
				switch (data.type) {
					case "location": {
						const result = await query(`
							INSERT INTO locations (game, name, description)
							VALUES (%L,%L,%L)`,
							[data.game, data.name.toLowerCase(), data.description]);
						return await show_file('location.html',
							result.insertId, "",
							sanitize(data.name.toLowerCase()), "");
					} case "object": {
						const is_anywhere = !isNaN(parseInt(data.location));
						if (is_anywhere) await location_match_game(location, game);
						const result = await query(`
							INSERT INTO objects (game, name, location)
							VALUES (%L,%L,%L)`,
							[data.game, data.name.toLowerCase(),
							is_anywhere ? data.location : null]);
						return await show_file('object.html',
							result.insertId, sanitize(data.name.toLowerCase()));
					} case "action": {
						await object_match_game(data.item, data.game);
						const result = await query(`
							INSERT INTO actions (obj1) VALUES (%L)`,
							[data.item]);
						const name = await query(`
							SELECT name FROM objects WHERE ID = %L`, [data.item]);
						return await show_file('action.html',
							result.insertId, sanitize(name[0].name),
							await all_objects(await get_objs(data.game)),
							...get_win_lose_array({ ID: result.insertId, win: null }));
					} case "pick_up_action": {
						await object_match_game(data.item, data.game);
						const result = await query(`
							INSERT INTO grab (obj) VALUES (%L)`, [data.item]);
						const name = await query(`
							SELECT name FROM objects WHERE ID = %L`, [data.item]);
						return await show_file('pick-up-action.html',
							result.insertId, sanitize(name[0].name), 'checked',
							...get_win_lose_array({ ID: result.insertId, win: null }));
					} case "path": {
						await location_match_game(data.item, data.game);
						const result = await query(`
							INSERT INTO paths (start) VALUES (%L, %L)`, [data.item]);
						return await show_file('path.html', result.insertId,
							await all_locations(data.game, data.item),
							get_win_lose_array({ ID: result.insertId, win: null }));
					} case "description": {
						await location_match_game(data.item, data.game);
						await query(`
							UPDATE descriptions
							SET num = num + 1
							WHERE location = %L AND num >= %L`,
							[data.item, data.num]);
						const description = await query(`
							INSERT INTO descriptions (location, num)
							VALUES (%L, %L)`, [data.item, data.num]);
						return await show_file('description.html',
							description.insertId, '', '', '', '');
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
								SELECT ID FROM constraint_and_effect
								WHERE obj = %L AND state = %L`, select_params);
							id = exists.length ? exists[0].ID : (await query(`
								INSERT INTO constraint_and_effect (obj, state)
								VALUES (%L, %L)`, select_params)).insertId;
						} else if (type1 === 'location-') {
							await location_match_game(data.value, data.game);
							const exists = await query(`
								SELECT ID FROM location_constraint_and_effect
								WHERE obj = %L AND location = %L`, select_params);
							id = exists.length ? exists[0].ID : (await query(`
								INSERT INTO location_constraint_and_effect
									(obj, location)
								VALUES (%L, %L)`, select_params)).insertId;
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
					WHERE ID = %L`, [data.id, data.game]);
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
				await query(`UPDATE %I SET name = %L WHERE ID = %L`,
					[table, data.name.toLowerCase(), data.id]);
				res.statusCode = 204;
				break;
			} case '/change/description': {
				restrict(permission, 1);
				if (data.type === 'location') {
					const valid = await query(`
						SELECT COUNT(*) AS valid FROM locations
						JOIN descriptions ON descriptions.location = locations.ID
						WHERE locations.game = %L AND descriptions.ID = %L`,
						[data.game, data.id]);
					if (!valid[0].valid) throw 'description does not match game';
					await query(`
						UPDATE descriptions SET text = %L
						WHERE ID = %L`,
						[data.text, data.id]);
				} else {
					await action_match_game(data.type, data.id, data.game);
					await query(`
						UPDATE %I SET text = %L
						WHERE ID = %L`,
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
						WHERE ID = %L`, [data.newitem, data.id]);
				} else if (data.type === 'path') {
					await query(`
						UPDATE paths SET end_ = %L
						WHERE ID = %L`, [data.newitem, data.id]);
				} else if (data.type === 'pick_up_action') {
					await query(`
						UPDATE grab SET success = %L
						WHERE ID = %L`, [data.state, data.id]);
				}
				res.statusCode = 204;
				break;
			} case '/change/win': {
				restrict(permission, 1);
				await action_match_game(data.type, data.id, data.game);
				await query(`
					UPDATE %I SET win = %L
					WHERE ID = %L`,
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
					WHERE ID = %L`, [data.game]);
				break;
			case "location":
				await query(`
					DELETE FROM locations
					WHERE ID = %L AND game = %L`,
					[data.id, data.game]);
				break;
			case "object":
				await query(`
					DELETE FROM objects
					WHERE ID = %L AND game = %L`,
					[data.id, data.game]);
				break;
			case "action":
			case "pick_up_action":
			case "path":
				await action_match_game(data.type, data.id, data.game);
				await query(`
					DELETE FROM %I WHERE ID = %L`,
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
						JOIN locations ON descriptions.location = locations.ID
						WHERE descriptions.ID = %L AND locations.game = ?`,
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
						(type1 ? '' : 'location') + type2;
					const table2 = (type1 ? '' : 'location_') +
						'constraint_and_effect';
					await query(`
						DELETE %I FROM %I
						JOIN %I ON %I.%I = %I.ID
						WHERE %I.%I = %L
						AND %I.obj = %L`,
						[table1, table2, table1, table1,
							type2 === 'constraint' ? 'constraint_' : 'effect',
							table2, table1, column_list.get(data.parenttype),
							data.item, table2, data.obj]);
				}
			}
		}
	}


	function obj_index(objects, ID) {
		return objects.findIndex(obj => obj.ID === ID);
	}

	async function location_match_game(location, game) {
		const valid = await query(`
			SELECT COUNT(*) AS valid FROM locations
			WHERE ID = %L AND game = %L`, [location, game]);
		if (!valid[0].valid) throw "location does not match game";
	}

	async function object_match_game(object, game) {
		const valid = await query(`
			SELECT COUNT(*) AS valid FROM objects
			WHERE ID = %L AND game = %L`, [object, game]);
		if (!valid[0].valid) throw "object does not match game";
	}

	const obj_column_map = new StrictMap([
		['action', 'obj1'], ['pick_up_action', 'obj'], ['path', 'start']
	]);
	async function action_match_game(type, id, game) {
		const table = table_list.get(type);
		const table2 = type === 'path' ? 'locations' : 'objects';
		if (!(await query(`
			SELECT COUNT(*) AS valid FROM %I
			JOIN %I ON %I.ID = %I.%I
			WHERE %I.game = %L AND %I.ID = %L`,
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
			if (constraint.ID !== current_ID) {
				if (valid) return valid;
				valid = constraint;
				current_ID = constraint.ID;
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
			await describe(data),
			sanitize(text),
			token, data.inventory.size ?
			`You have: ${
			sanitize(Array.from(data.inventory, i => data.objects[i].name).join(', '))
			}` : "",
			encodeURIComponent(data.game));
	}

	function win_lose({ game, moves }, { text, win }) {
		return show_file('win.html',
			sanitize(game),
			sanitize(text),
			win ? 'win!' : 'lose.', moves + 1,
			encodeURIComponent(game));
	}

	async function describe(data) {
		let description = "";
		for (const item of await get_constraint_array(data.location)) {
			description += satisfy_constraints(
				data.states, data.moved_objects, data.inventory,
				item, data.objects).text || "";
		}
		return sanitize(description);
	}

	async function get_constraint_array(location) {
		const chunks = await query(`
			SELECT constraint_and_effect.obj,
				constraint_and_effect.state,
				location_constraint_and_effect.obj AS loc_obj,
				location_constraint_and_effect.location,
				description_to_inventory_constraint.obj AS inv_obj,
				description_to_inventory_constraint.have_it,
				descriptions.ID,
				descriptions.num,
				descriptions.text FROM descriptions
			LEFT JOIN description_to_constraint
				ON descriptions.ID = description_to_constraint.description
			LEFT JOIN constraint_and_effect
				ON constraint_and_effect.ID = description_to_constraint.constraint_
			LEFT JOIN description_to_location_constraint
				ON descriptions.ID = description_to_location_constraint.description
			LEFT JOIN location_constraint_and_effect
				ON location_constraint_and_effect.ID =
					description_to_location_constraint.constraint_
			LEFT JOIN description_to_inventory_constraint
				ON descriptions.ID = description_to_inventory_constraint.description
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

	function get_win_lose_array({ win, ID }) {
		return [
			ID, win === null ? 'checked' : '',
			ID, win === 1 ? 'checked' : '',
			ID, win === 0 ? 'checked' : ''];
	}

	async function invalid_request(res) {
		res.statusCode = 400;
		res.end(await show_file('invalid-request.html'));
	}

	async function show_file(path, ...args) {
		return util.format(await files.get(path), ...args);
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

	async function get_objs(game) {
		return await query(`
			SELECT ID, name FROM objects
			WHERE game = %L ORDER BY location`, [game]);
	}

	async function all_objects(objs, id) {
		const options = objs.map(elem =>
			`<option value="${elem.ID}" ${id === elem.ID ? 'selected' : ''}>` +
			sanitize(elem.name) + `</option>`);
		return `<option></option>` + options.join('');
	}
	async function all_locations(game, no, id) {
		const locations = await query(`
			SELECT * FROM locations WHERE game = %L`, [game]);
		const options = locations.map(elem => elem.ID === no ? '' :
			`<option value="${elem.ID}" ${id === elem.ID ? 'selected' : ''}>` +
			elem.name + `</option>`);
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
			secure: true
		}));
	}
}