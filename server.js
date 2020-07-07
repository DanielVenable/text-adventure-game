'use strict';

const http = require('http'),
	mysql = require('mysql'),
	url = require('url'),
	fs = require('fs'),
	util = require('util'),
	crypto = require('crypto'),
	jwt = require('jsonwebtoken'),
	cookie = require('cookie'),
	port = process.argv[2] || 80;

process.chdir(__dirname + '/files');

const sql = mysql.createConnection({
	host: "localhost",
	user: "text_adventure_game",
	password: "D8T3tcHE~td03;[)jftvi <+3",
	database: "text_adventure_games"
});
sql.connect();

const query = util.promisify(sql.query).bind(sql),
	files = {
		readFile: util.promisify(fs.readFile),
		get: async function (path) {
			if (!this[path]) files[path] = (await this.readFile(path)).toString();
			return this[path];
		}
	}, table_list = {
		action: 'actions',
		pick_up_action: 'grab',
		path: 'paths'
	}, start_table_list = {
		action: 'action_to_',
		pick_up_action: 'grab_to_',
		path: 'path_to_'
	}, column_list = {
		action: 'action',
		pick_up_action: 'grab',
		path: 'path'
	}, go_to = /^go (?:to )?(.+)$/,
	use = /^use (?:(.+) on )?(.+)$/,
	pick_up = /^(?:pick up|grab|get) (.+)$/;

http.createServer(async (req, res) => {
	try {
		let user, userid;
		try {
			user = jwt.verify(
				cookie.parse(req.headers.cookie).token,
				jwtKey).username;
			userid = await query(`
				SELECT ID FROM users
				WHERE username = ?`, user);
			userid = userid[0].ID;
		} catch (e) { }
		res.setHeader('Content-Type', 'text/html');
		res.statusCode = 200;
		const parsed_url = url.parse(req.url, true);
		if (req.method === 'GET') {
			if (parsed_url.pathname === "/play") {
				const command = parsed_url.query.cmd.toLowerCase(),
					states = toHalfByteArray(parsed_url.query.a),
					locationID = parsed_url.query.b,
					inventory = parsed_url.query.c
						.split(' ')
						.map(x => parseInt(x))
						.filter(elem => !isNaN(elem)),
					location = await query(`
						SELECT * FROM locations
						WHERE ID = ?`, [locationID]),
					game = await query(`
						SELECT public, name FROM games
						WHERE ID = ?`, [location[0].game]);
				if (!game[0].public)
					restrict(await query(`
						SELECT * FROM user_to_game
						WHERE user = ? AND game = ?`,
						[userid, location[0].game]
					), 0);
				const objects = await query(`
						SELECT * FROM objects
						WHERE game = ? ORDER BY ID`, [location[0].game]),
					show_data = {
						res, game: game[0].name, states,
						location: locationID, inventory, objects
					}, split_go_to = command.match(go_to),
					split_pick_up = command.match(pick_up),
					split_use = command.match(use);
				if (split_go_to) {
					const end_location = await query(`
						SELECT ID FROM locations
						WHERE name = ? AND game = ?`,
						[split_go_to[1], location[0].game]);
					if (end_location.length === 1) {
						const constraints = await query(`
							SELECT paths.ID, paths.text,
								constraint_and_effect.obj,
								constraint_and_effect.state FROM paths
							LEFT JOIN path_to_constraint
								ON paths.ID = path_to_constraint.path
							LEFT JOIN constraint_and_effect
								ON constraint_and_effect.ID =
									path_to_constraint.constraint_
							WHERE paths.start = ? AND paths.end = ?
							ORDER BY paths.ID;`,
							[locationID, end_location[0].ID]);
						const result = satisfy_constraints(
							states, constraints, objects);
						if (result) {
							const effects = await query(`
								SELECT constraint_and_effect.obj,
									constraint_and_effect.state FROM paths
								JOIN path_to_effect
									ON paths.ID = path_to_effect.path
								JOIN constraint_and_effect
									ON constraint_and_effect.ID =
										path_to_effect.effect
								WHERE paths.start = ? AND paths.end = ?`,
								[locationID, end_location[0].ID]);
							handle_effects(effects, objects, states);
							show_data.location = end_location[0].ID;
							await show(show_data, result.text);
						} else await show(show_data, 'Nothing happens.');
					} else await show(show_data, 'Nothing happens.');
				} else if (split_pick_up) {
					const obj = await query(`
						SELECT ID FROM objects
						WHERE name = ? AND game = ? AND location = ?;`,
						[split_pick_up[1], location[0].game, locationID]);
					if (obj.length === 1) {
						if (inventory.includes(obj[0].ID)) {
							await show(show_data, "You already have it.");
						} else {
							const constraints = await query(`
								SELECT grab.ID, grab.text, grab.success,
									constraint_and_effect.obj,
									constraint_and_effect.state FROM grab
								LEFT JOIN grab_to_constraint
									ON grab.ID = grab_to_constraint.grab
								LEFT JOIN constraint_and_effect
									ON constraint_and_effect.ID =
										grab_to_constraint.constraint_
								WHERE grab.obj = ?
								ORDER BY grab.ID`, [obj[0].ID]);
							const result = satisfy_constraints(
								states, constraints, objects);
							if (result) {
								const effects = await query(`
									SELECT constraint_and_effect.obj,
										constraint_and_effect.state FROM grab
									JOIN grab_to_effect
										ON grab.ID = grab_to_effect.grab
									JOIN constraint_and_effect
										ON constraint_and_effect.ID =
											grab_to_effect.effect
									WHERE grab.ID = ?`, [result.ID]);
								handle_effects(effects, objects, states);
								if (result.success) {
									inventory.push(obj[0].ID);
									await show(show_data,
										result.text ? result.text + ' ' : '' +
											`You have ${a_an(split_pick_up[1])}.`);
								} else {
									await show(show_data,
										result.text ?
											result.text : "Nothing happens.");
								}
							} else await show(show_data, "Nothing happens.");
						}
					} else await show(show_data, "Nothing happens.");
				} else if (split_use) {
					if (split_use[1] === undefined) {
						await use_on(null, split_use[2]);
					} else {
						const item1 = await query(`
							SELECT ID FROM objects
							WHERE name = ?`, [split_use[1]]);
						if (item1.length === 1 && inventory.includes(item1[0].ID)) {
							await use_on(item1[0].ID, split_use[2]);
						} else {
							await show(show_data,
								`You don't have ${a_an(split_use[1])}`);
						}
					}
					async function use_on(first_ID, second_name) {
						const item2 = await query(`
							SELECT ID, location FROM objects
							WHERE name = ?`, [second_name]);
						let valid_items = [];
						for (const item of item2)
							if (item.location == locationID ||
								inventory.includes(item.ID))
								valid_items.push(item);
						if (valid_items.length === 1) {
							const constraints = await query(`
								SELECT actions.ID, actions.text,
									constraint_and_effect.obj,
									constraint_and_effect.state FROM actions
								LEFT JOIN action_to_constraint
									ON actions.ID = action_to_constraint.action
								LEFT JOIN constraint_and_effect
									ON constraint_and_effect.ID =
										action_to_constraint.constraint_
								WHERE actions.obj1 = ? AND actions.obj2 = ?
								ORDER BY actions.ID;`, [first_ID, item2[0].ID]);
							const result = satisfy_constraints(
								states, constraints, objects);
							if (result) {
								const effects = await query(`
									SELECT constraint_and_effect.obj,
										constraint_and_effect.state FROM actions
									JOIN action_to_effect
										ON actions.ID = action_to_effect.action
									JOIN constraint_and_effect
										ON constraint_and_effect.ID =
											action_to_effect.effect
									WHERE actions.ID = ?;`, [result.ID]);
								handle_effects(effects, objects, states);
								await show(show_data,
									result.text ? result.text : "Nothing happens.");
							} else await show(show_data, "Nothing happens.");
						} else await show(show_data, "Nothing happens.");
					}
				} else await show(show_data, "Invalid command");
			} else if (req.url === '/') {
				const result = await query(`
					SELECT name FROM games
					WHERE start IS NOT NULL ORDER BY name`);
				let game_list = "";
				for (const game of result)
					game_list += await show_file('start-game-link.html',
						encodeURIComponent(game.name), sanitize(game.name));
				res.end(await show_file('home-page.html', game_list));
			} else if (parsed_url.pathname === '/start') {
				const game = parsed_url.query.game;
				const result = await query(`
					SELECT locations.ID, games.text FROM games
					JOIN locations ON locations.ID = games.start
					WHERE games.name = ?`, [game]);
				res.end(await show_file('play.html',
					sanitize(game),
					sanitize(result[0].text),
					await describe({location: result[0].ID, states: [], objects: []}),
					"", result[0].ID, "", "",
					encodeURIComponent(game)));
			} else if (req.url === '/edit') {
				const result = await query(`
					SELECT name, ID FROM games ORDER BY name`);
				let game_list = "";
				for (const game of result)
					game_list += `<option>${sanitize(game.name)}</option>`;
				res.end(await show_file('choose-edit.html', game_list));
			} else if (parsed_url.pathname === '/edit' && parsed_url.query.game) {
				const game = await query(`
					SELECT * FROM games
					WHERE name = ?`, [parsed_url.query.game]);
				restrict(await query(`
					SELECT permission FROM user_to_game
					WHERE user = ? AND game = ?`, [userid, game[0].ID]), 1);
				const locations = await query(`
					SELECT * FROM locations WHERE game = ?`, [game[0].ID]);
				let location_list = "";
				for (const location of locations)
					if (game[0].start === location.ID) {
						location_list += await show_file('location.html',
							location.ID, "start",
							sanitize(location.name), "hidden");
					} else {
						location_list += await show_file('location.html',
							location.ID, "",
							sanitize(location.name), "");
					}
				const objects = await query(`
					SELECT * FROM objects
					WHERE location IS NULL AND game = ?`, [game[0].ID]);
				let obj_list = "";
				for (const obj of objects)
					obj_list += await show_file('object.html', obj.ID, obj.name);
				res.end(await show_file('edit.html',
					location_list,
					obj_list,
					encodeURIComponent(game[0].name),
					game[0].ID));
			} else if (req.url === '/new') {
				res.end(await show_file('new-game.html'));
			} else if (req.url === '/signin') {
				res.end(await show_file('sign-in.html', '/', 'hidden', '/'));
			} else if (req.url === '/navbar.css') {
				res.setHeader('Content-Type', 'text/css');
				res.end(await show_file('navbar.css'));
			} else if (parsed_url.pathname === '/expand') {
				const permission = await query(`
					SELECT permission FROM user_to_game
					WHERE user = ? AND game = ?`,
					[userid, parsed_url.query.game]);
				restrict(permission, 1);
				if (permission.length && permission[0].permission >= 1) {
					switch (parsed_url.query.type) {
						case "location": {
							const allowed = await query(`
								SELECT COUNT(*) AS num FROM locations
								WHERE game = ? AND ID = ?`,
								[parsed_url.query.game, parsed_url.query.id]);
							if (allowed[0].num) {
								let description = '';
								for (const item of
										await get_constraint_array(parsed_url.query.id)) {
									if (item[0].obj) {
										for (const constraint of item) {
											description += await show_file(
												'description_constraint.html',
												await all_objects(
													parsed_url.query.game,
													constraint.obj),
												constraint.state);
										}
									}
									description += await show_file(
										'description.html',
										item[0].text);
								}
								res.write(await show_file('description-box.html',
									description));
								const result = await query(`
									SELECT name, ID FROM objects
									WHERE location = ?`, [parsed_url.query.id]);
								res.write(await show_file('list-start.html',
									'object', 'an object'));
								for (const obj of result)
									res.write(await show_file('object.html',
										obj.ID, sanitize(obj.name)));
								res.write(`</ul>`);
								res.write(await show_file('list-start.html',
									'path', 'a path'));
								const paths = await query(`
									SELECT * FROM paths
									WHERE start = ?`, [parsed_url.query.id]);
								for (const path of paths)
									res.write(await show_file('path.html',
										path.ID, await all_locations(
											parsed_url.query.game,
											parsed_url.query.id,
											path.end)));
								res.end(`</ul>`);
							} else throw "Location does not match game";
							break;
						} case "object": {
							const object = await query(`
								SELECT name FROM objects
								WHERE ID = ?`, [parsed_url.query.id]);
							const actions = await query(`
								SELECT actions.ID, actions.obj2 FROM actions
								WHERE actions.obj1 = ?`, [parsed_url.query.id]);
							res.write(await show_file('list-start.html',
								'action', 'an action'));
							for (const action of actions)
								res.write(await show_file('action.html',
									action.ID, sanitize(object[0].name),
									await all_objects(
										parsed_url.query.game, action.obj2)));
							res.write(`</ul>`);
							const grabs = await query(`
								SELECT * FROM grab
								WHERE grab.obj = ?`, [parsed_url.query.id]);
							res.write(await show_file('list-start.html',
								'pick_up_action', 'a pick up action'));
							for (const grab of grabs)
								res.write(await show_file('pick-up-action.html',
									grab.ID, object[0].name,
									grab.success ? 'checked' : ''));
							res.end('</ul>');
							break;
						} case "action":
						case "pick_up_action":
						case "path": {
							const text = await query(`
								SELECT text FROM ??
								WHERE ID = ?`,
								[table_list[parsed_url.query.type],
								parsed_url.query.id]);
							res.write(await show_file('textarea.html',
								text[0].text));
							const table_part = {
								action: "action",
								path: "path",
								pick_up_action: "grab"
							};
							let combined_table =
								table_part[parsed_url.query.type] + "_to_constraint";
							const constraints = await query(`
								SELECT constraint_and_effect.obj,
									constraint_and_effect.state
									FROM constraint_and_effect
								JOIN ${combined_table}
									ON constraint_and_effect.ID =
										${combined_table}.constraint_
								WHERE ${combined_table}.
									${table_part[parsed_url.query.type]} = ?`,
								[parsed_url.query.id]);
							combined_table = table_part[parsed_url.query.type] +
								"_to_effect";
							const effects = await query(`
								SELECT constraint_and_effect.obj,
									constraint_and_effect.state
								FROM constraint_and_effect
								JOIN ${combined_table}
									ON constraint_and_effect.ID =
										${combined_table}.effect
								WHERE ${combined_table}.
									${table_part[parsed_url.query.type]} = ?`,
								[parsed_url.query.id]);
							res.write(await show_file('list-start.html',
								'constraint', 'a constraint'));
							for (const constraint of constraints)
								res.write(await show_file('constraint_or_effect.html',
									constraint.obj,
									await all_objects(
										parsed_url.query.game, constraint.obj),
									'must be',
									constraint.state));
							res.write('</ul>');
							res.write(await show_file('list-start.html',
								'effect', 'an effect'));
							for (const effect of effects)
								res.write(await show_file('constraint_or_effect.html',
									effect.obj,
									await all_objects(
										parsed_url.query.game, effect.obj),
									'goes in',
									effect.state));
							res.end('</ul>');
							break;
						} default: await invalid_request(res);
					}
				} else {
					res.statusCode = 401;
					res.end();
				}
			} else if (parsed_url.pathname === '/check/game') {
				const taken = await query(`
					SELECT COUNT(*) AS num FROM games
					WHERE name = ?`, [parsed_url.query.name]);
				res.end(String(taken[0].num));
			} else if (parsed_url.pathname === '/check/username') {
				const taken = await query(`
					SELECT COUNT(*) AS num FROM users
					WHERE username = ?`, [parsed_url.query.username]);
				res.end(String(taken[0].num));
			} else {
				res.statusCode = 404;
				res.end(await show_file('404.html'));
			}
		} else if (req.method === 'POST') {
			let data = "";
			req.on('data', chunk => data += chunk);
			await new Promise(resolve => req.on('end', resolve));
			data = url.parse('?' + data, true).query;
			const permission = await query(`
				SELECT permission FROM user_to_game
				WHERE user = ? AND game = ?`,
				[userid, data.game]);
			if (req.url === '/create' && userid) {
				try {
					const game = await query(`
						INSERT INTO games (name) VALUES (?)`, [data.name]);
					await query(`
						INSERT INTO user_to_game (user, game, permission)
						VALUES (?, ?, 2)`, [userid, game.insertId]);
					res.statusCode = 201;
				} catch (e) {
					res.statusCode = 409;
				} finally {
					res.end();
				}
			} else if (req.url === '/signin') {
				const user = await query(`
					SELECT ID FROM users WHERE username = ? AND hash = ?`,
					[data.username, crypto.createHash('sha256')
						.update(data.password).digest('hex')]);
				if (user.length) {
					create_token(res, data.username);
					res.setHeader('Location', data.url);
					res.statusCode = 303;
					res.end();
				} else {
					res.statusCode = 401;
					res.end(await show_file('sign-in.html', data.url, '', data.url));
				}
			} else if (req.url === '/signup') {
				const hash = crypto.createHash('sha256')
					.update(data.password)
					.digest('hex');
				await query(`
					INSERT INTO users (username, hash) VALUES (?, ?)`,
					[data.username, hash]);
				create_token(res, data.username);
				res.setHeader('Location', data.url);
				res.statusCode = 303;
				res.end();
			} else if (req.url === '/add') {
				restrict(permission, 1);
				switch (data.type) {
					case "location": {
						const result = await query(`
							INSERT INTO locations (game, name, description)
							VALUES (?,?,?)`,
							[data.game, data.name.toLowerCase(), data.description]);
						res.end(await show_file('location.html',
							result.insertId, "",
							sanitize(data.name.toLowerCase()), ""));
						break;
					} case "object": {
						const is_anywhere = !isNaN(parseInt(data.location));
						if (is_anywhere) {
							const valid = await query(`
								SELECT COUNT(*) AS valid FROM locations
								WHERE ID = ? AND game = ?`,
								[data.location, data.game]);
							if (!valid[0].valid)
								throw "location does not match game";
						}
						const result = await query(`
							INSERT INTO objects (game, name, location)
							VALUES (?,?,?)`,
							[data.game, data.name.toLowerCase(),
							is_anywhere ? data.location : null]);
						res.end(await show_file('object.html',
							result.insertId, sanitize(data.name.toLowerCase())));
						break;
					} case "action": {
						const valid = await query(`
							SELECT COUNT(*) AS valid FROM objects
							WHERE ID = ? AND game = ?`,
							[data.item, data.game]);
						if (!valid[0].valid) throw "object does not match game";
						const result = await query(`
							INSERT INTO actions (obj1) VALUES (?)`,
							[data.item]);
						const name = await query(`
							SELECT name FROM objects WHERE ID = ?`, [data.item]);
						res.end(await show_file('action.html',
							result.insertId, sanitize(name[0].name),
							await all_objects(data.game)));
						break;
					} case "pick_up_action": {
						const result = await query(`
							INSERT INTO grab (obj) VALUES (?)`, [data.item]);
						const name = await query(`
							SELECT name FROM objects WHERE ID = ?`, [data.item]);
						res.end(await show_file('pick-up-action.html',
							result.insertId, sanitize(name[0].name), 'checked'));
						break;
					} case "path": {
						const result = await query(`
							INSERT INTO paths (start, game)
							VALUES (?, ?)`, [data.item, data.game])
						res.end(await show_file('path.html', result.insertId,
							await all_locations(data.game, data.item)));
						break;
					} case "constraint":
					case "effect": {
						if (data.obj && data.obj !== 'null')
							await add_constraint_or_effect(
								data.obj,
								data.type === 'constraint',
								data.parenttype,
								data.item,
								data.state);
						res.end(await show_file(
							'constraint_or_effect.html',
							data.obj,
							await all_objects(data.game, data.obj),
							data.type === 'constraint' ?
								'must be' : 'goes in', 0));
						break;
					} case "description": {
						const valid = await query(`
							SELECT COUNT(*) AS valid FROM locations
							WHERE ID = ? AND game = ?`, [data.item, data.game]);
						if (!valid[0].valid) throw "location does not match game";
						await query(`
							UPDATE descriptions
							SET num = num + 1
							WHERE location = ? AND num >= ?`,
							[data.item, data.num]);
						await query(`
							INSERT INTO descriptions (location, num)
							VALUES (?, ?)`, [data.item, data.num]);
						res.end(await show_file('description.html', ''));
					} default: await invalid_request(res);
				}
			} else if (req.url === '/setstart') {
				restrict(permission, 1);
				await query(`
					UPDATE games SET start = ?
					WHERE ID = ?`, [data.id, data.game]);
				res.statusCode = 204;
				res.end();
			} else if (req.url === '/rename') {
				restrict(permission, 1);
				switch (data.type) {
					case "location":
						await query(`
							UPDATE locations SET name = ?
							WHERE ID = ?`, [data.name.toLowerCase(), data.id]);
						break;
					case "object":
						await query(`
							UPDATE objects SET name = ?
							WHERE ID = ?`, [data.name.toLowerCase(), data.id]);
						break;
					default: throw "Not a valid type";
				}
				res.statusCode = 204;
				res.end();
			} else if (req.url === '/change/description') {
				restrict(permission, 1);
				if (data.type === 'location') {
					console.log(data);
				} else {
					await query(`
						UPDATE ?? SET text = ?
						WHERE ID = ?`,
						[table_list[data.type], data.text, data.id]);
				}
				res.statusCode = 204;
				res.end();
			} else if (req.url === '/change/item') {
				restrict(permission, 1);
				if (data.type === 'action') {
					await query(`
						UPDATE actions SET obj2 = ?
						WHERE ID = ?`, [data.newitem, data.id]);
				} else if (data.type === 'path') {
					await query(`
						UPDATE paths SET end = ?
						WHERE ID = ?`, [data.newitem, data.id]);
				} else if (data.type === 'pick_up_action')
					await query(`
						UPDATE grab SET success = ?
						WHERE ID = ?`, [data.state, data.id]);
				res.statusCode = 204;
				res.end();
			} else {
				res.statusCode = 404;
				res.end(await show_file('404.html'));
			}
		} else if (req.method === 'DELETE' && parsed_url.pathname === '/remove') {
			const permission = await query(`
				SELECT permission FROM user_to_game
				WHERE user = ? AND game = ?`,
				[userid, parsed_url.query.game]);
			res.statusCode = 204;
			restrict(permission, 1);
			switch (parsed_url.query.type) {
				case "game":
					restrict(permission, 2);
					await query(`
						DELETE FROM games
						WHERE ID = ?`, [parsed_url.query.game]);
					res.statusCode = 410;
					break;
				case "location":
					await query(`
						DELETE FROM locations
						WHERE ID = ? AND game = ?`,
						[parsed_url.query.id, parsed_url.query.game]);
					break;
				case "object":
					await query(`
						DELETE FROM objects
						WHERE ID = ? AND game = ?`,
						[parsed_url.query.id, parsed_url.query.game]);
					break;
				case "action":
					await query(`
						DELETE FROM actions
						WHERE ID = ?`, [parsed_url.query.id]);
					break;
				case "pick_up_action":
					await query(`
						DELETE FROM grab
						WHERE ID = ?`, [parsed_url.query.id]);
					break;
				case "path":
					await query(`
						DELETE FROM paths
						WHERE ID = ?`, [parsed_url.query.id]);
					break;
				case "constraint":
				case "effect":
					await remove_constraint_or_effect(
						parsed_url.query.id,
						parsed_url.query.type === 'constraint',
						parsed_url.query.parenttype,
						parsed_url.query.item);
					break;
				case "description":
					await query(`
						DELETE FROM descriptions
						WHERE location = ? AND num = ?`,
						[parsed_url.query.item, parsed_url.query.num]);
					await query(`
						UPDATE descriptions
						SET num = num - 1
						WHERE location = ? AND num > ?`,
						[parsed_url.query.item, parsed_url.query.num]);
					break;
				default: res.statusCode = 404;
			}
			res.end();
		} else await invalid_request(res);
	} catch (error) {
		if (error === "Unauthorized action") {
			res.statusCode = 401;
			if (req.method === "GET") {
				res.end(await show_file('sign-in.html', req.url, 'hidden', req.url));
			} else res.end();
		} else await invalid_request(res);
		console.error(error);
	}
}).listen(port, () => console.log(`Server running at http://localhost:${port}`));

function restrict(permission, level) {
	if (!permission.length || permission[0].permission < level)
		throw "Unauthorized action";
}

function handle_effects(effects, objects, states) {
	for (const effect of effects)
		states[objects.findIndex(obj => obj.ID === effect.obj)] = effect.state;
}

function satisfy_constraints(states, constraints, objects) {
	let current_ID,
		valid = false;
	for (const constraint of constraints) {
		if (constraint.obj === null) return constraint;
		if (constraint.ID != current_ID) {
			if (valid) return valid;
			valid = constraint;
			current_ID = constraint.ID;
		}
		const state = states[objects.findIndex(obj => obj.ID === constraint.obj)] || 0;
		if (state !== constraint.state) valid = false;
	}
	return valid;
}

async function show(data, text) {
	let description = await describe(data);
	if (data.inventory.length === 0) {
		const file = await show_file('play.html',
			sanitize(data.game),
			sanitize(description),
			sanitize(text),
			toHexString(data.states),
			data.location, "", "",
			encodeURIComponent(data.game));
		data.res.end(file);
	} else {
		const inventory = await query(`
			SELECT name FROM objects WHERE ID IN (?)`, [data.inventory]);
		let objects = "";
		inventory.forEach((item, index) =>
			objects += (index === 0 ? "" : ", ") + item.name);
		const file = await show_file('play.html',
			sanitize(data.game),
			description,
			sanitize(text),
			toHexString(data.states),
			data.location,
			data.inventory.join(' '),
			`<p>You have: ${sanitize(objects)}</p>`,
			encodeURIComponent(data.game)
		);
		data.res.end(file);
	}
}

async function describe(data) {
	let description = "";
	for (const item of await get_constraint_array(data.location)) {
		description +=
			satisfy_constraints(data.states, item, data.objects).text || "";
	}
	return sanitize(description);
}

async function get_constraint_array(location) {
	const chunks = await query(`
		SELECT * FROM descriptions
		LEFT JOIN description_to_constraint
			ON descriptions.ID = description_to_constraint.description
		LEFT JOIN constraint_and_effect
			ON constraint_and_effect.ID = description_to_constraint.constraint_
		WHERE descriptions.location = ?
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

async function invalid_request(res) {
	res.statusCode = 400;
	res.end(await show_file('invalid-request.html'));
}

async function show_file(path, ...args) {
	args.unshift(await files.get(path));
	return util.format.apply(null, args);
}

function sanitize(str) {
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

async function all_objects(game, id) {
	const objs = await query(`
		SELECT * FROM objects
		WHERE game = ? ORDER BY location`, [game]);
	const options = objs.map(elem =>
		`<option value="${elem.ID}" ${id === elem.ID ? 'selected' : ''}>` +
		elem.name + `</option>`);
	return `<option></option>` + options.join('');
}
async function all_locations(game, no, id) {
	const locations = await query(`
		SELECT * FROM locations WHERE game = ?`, [game]);
	const options = locations.map(elem => elem.ID === no ? '' :
		`<option value="${elem.ID}" ${id === elem.ID ? 'selected' : ''}>` +
		elem.name + `</option>`);
	return `<option></option>` + options.join('');
}

/**
 * @param {number} obj the ID of an object
 * @param {boolean} is_constraint
 * @param {'action' | 'pick_up_action' | 'path'} type
 * @param {number} item the ID of an action, grab, or path
 * @param {number} state an integer from 0 to 15
 */
async function add_constraint_or_effect(obj, is_constraint, type, item, state = 0) {
	const exists = await query(`
		SELECT ID FROM constraint_and_effect
		WHERE obj = ? AND state = ?`, [obj, state]);
	const id = exists.length ? exists[0].id : (await query(`
		INSERT INTO constraint_and_effect (obj, state)
		VALUES (?, ?)`, [obj, state])).insertId;
	if (is_constraint) {
		await query(`
			INSERT INTO ${start_table_list[type]}constraint
				(${column_list[type]}, constraint_)
			VALUES (?, ?)`, [item, id]);
	} else {
		await query(`
			INSERT INTO ${start_table_list[type]}effect
				(${column_list[type]}, effect)
			VALUES (?, ?)`, [item, id]);
	}
}
/**
 * @param {number} obj the ID of an object
 * @param {boolean} is_constraint
 * @param {'action' | 'pick_up_action' | 'path'} type
 * @param {number} item the ID of an action, grab, or path
 */
async function remove_constraint_or_effect(obj, is_constraint, type, item) {
	if (is_constraint) {
		const table = start_table_list[type] + 'constraint';
		await query(`
			DELETE ${table} FROM constraint_and_effect
			JOIN ${table} ON ${table}.constraint_ = constraint_and_effect.ID
			WHERE ${table}.${column_list[type]} = ?
			AND constraint_and_effect.obj = ?`, [item, obj]);
	} else {
		const table = start_table_list[type] + 'effect';
		await query(`
			DELETE ${table} FROM constraint_and_effect
			JOIN ${table} ON ${table}.effect = constraint_and_effect.ID
			WHERE ${table}.${column_list[type]} = ?
			AND constraint_and_effect.obj = ?`, [item, obj]);
	}
}

function toHexString(halfByteArray) {
	for (let i = 0; i < halfByteArray.length; i++)
		if (halfByteArray[i] === undefined) halfByteArray[i] = 0;
	return halfByteArray.map(byte =>
		('0' + (byte & 0xF).toString(16)).slice(-1)
	).join('');
}
function toHalfByteArray(hexString) {
	if (typeof hexString === 'string') {
		let result = [];
		const length = hexString.length;
		for (let i = 0; i < length; i += 1)
			result.push(parseInt(hexString.substr(i, 1), 16));
		return result;
	}
}

function a_an(string) {
	return /^[aeiou]/i.test(string) ? `an ${string}` : `a ${string}`;
}

const jwtKey = crypto.randomBytes(256);
const expire_seconds = 60 * 60 * 12;

function create_token(res, username) {
	const token = jwt.sign({ username }, jwtKey, {
		algorithm: "HS256",
		expiresIn: expire_seconds,
	});
	res.setHeader('Set-Cookie', cookie.serialize('token', token, {
		maxAge: expire_seconds,
		httpOnly: true,
		sameSite: 'lax'
	}));
	// add secure when https
}