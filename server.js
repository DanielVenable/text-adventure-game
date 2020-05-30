const http = require('http');
const mysql = require('mysql');
const url = require('url');
const fs = require('fs');
const util = require('util');
const port = 8000;

process.chdir(__dirname + '/pages');

const sql = mysql.createConnection({
	host: "localhost",
	user: "text_adventure_game",
	password: "D8T3tcHE~td03;[)jftvi <+3",
	database: "text_adventure_games"
});
sql.connect();

const query = util.promisify(sql.query).bind(sql);

const files = {
	readFile: util.promisify(fs.readFile),
	get: async path =>
		files[path] ?
		files[path] :
		files[path] = (await files.readFile(path)).toString()
};

http.createServer(async (req, res) => {
	try {
		res.setHeader('Content-Type', 'text/html');
		res.statusCode = 200;
		const parsed_url = url.parse(req.url, true);
		if (parsed_url.pathname == "/play") {
			const command = parsed_url.query.cmd;
			const states = toHalfByteArray(parsed_url.query.a);
			const locationID = parsed_url.query.b;
			var inventory = parsed_url.query.c.split(' ').map(parseInt).filter(elem => !isNaN(elem));
			const location = await query(`SELECT * FROM locations WHERE ID = ?`, [locationID]);
			const show_data = {
				res:res, game:location[0].game, states:states, location:locationID, inventory:inventory
			};
			const objects = await query(`SELECT * FROM objects WHERE game = ? ORDER BY ID`, [location[0].game]);
			if (command.startsWith('go to ')) {
				const end_location = await query(`
					SELECT ID, description FROM locations WHERE name = ? AND game = ?`,
					[command.split(/^go to /)[1], location[0].game]);
				if (end_location.length == 1) {
					const constraints = await query(`
						SELECT paths.ID, constraints.obj, constraints.state FROM paths
						LEFT JOIN path_to_constraint ON paths.ID = path_to_constraint.path
						LEFT JOIN constraints ON constraints.ID = path_to_constraint.constraint_
						WHERE paths.start = ? AND paths.end = ?
						ORDER BY paths.ID;`,
						[location[0].ID, end_location[0].ID]);
					const result = satisfy_constraints(states, constraints, objects);
					if (result) {
						const effects = await query(`
							SELECT effects.obj, effects.state, effects.text FROM paths
							JOIN path_to_effect ON paths.ID = path_to_effect.path
							JOIN effects ON effects.ID = path_to_effect.effect
							WHERE paths.start = ? AND paths.end = ?`,
							[location[0].ID, end_location[0].ID]);
						const text = handle_effects(effects, objects, states);
						show_data.location = end_location[0].ID;
						show(show_data, (text ? text + " " : "") + end_location[0].description);
					} else {
						show(show_data, "Nothing happens.");
					}
				} else {
					show(show_data, 'Nothing happens.');
				}
			} else if (command.startsWith('pick up ')) {
				const name = command.split(/^pick up /)[1];
				const obj = await query(`
					SELECT ID FROM objects WHERE name = ? AND game = ? AND location = ?;`,
					[name, location[0].game, locationID]);
				if (obj.length == 1) {
					if (inventory.includes(obj[0].ID)) {
						show(show_data, "You already have it.");
					} else {
						const constraints = await query(`
							SELECT grab.ID, grab.success, constraints.obj, constraints.state FROM grab
							LEFT JOIN grab_to_constraint ON grab.ID = grab_to_constraint.grab
							LEFT JOIN constraints ON constraints.ID = grab_to_constraint.constraint_
							WHERE grab.obj = ?
							ORDER BY grab.ID;`, [obj[0].ID]);
						const result = satisfy_constraints(states, constraints, objects);
						if (result) {
							const effects = await query(`
								SELECT effects.obj, effects.state, effects.text FROM grab
								JOIN grab_to_effect ON grab.ID = grab_to_effect.grab
								JOIN effects ON effects.ID = grab_to_effect.effect
								WHERE grab.ID = ?`, [obj[0].ID]);
							const text = handle_effects(effects, objects, states);
							if (result.success) {
								inventory.push(obj[0].ID);
								show(show_data, `${text ? text + ' ' : ''}You have ${a_an(name)}.`);
							} else {
								show(show_data, text ? text : "Nothing happens.");
							}
						} else {
							show(show_data, "Nothing happens.");
						}
					}
				} else {
					show(show_data, `There is no ${name} here.`);
				}
			} else if (/^use .+/.test(command)) {
				const objs = command.split(/^use /)[1].split(' on ');
				if (objs[1] === undefined) {
					use_on(null, objs[0]);
				} else {
					const item1 = await query(`SELECT ID FROM objects WHERE name = ?`, [objs[0]]);
					if (item1.length == 1 && inventory.includes(item1[0].ID)) {
						use_on(item1[0].ID, objs[1]);
					} else {
						show(show_data, `You don't have ${a_an(objs[0])}`);
					}
				}
				async function use_on(first_ID, second_name) {
					const item2 = await query(`SELECT ID, location FROM objects WHERE name = ?`, [second_name]);
					var valid_items = [];
					for (const item of item2) if (item.location == locationID || inventory.includes(item.ID)) valid_items.push(item);
					if (valid_items.length == 1) {
						const constraints = await query(`
							SELECT actions.ID, constraints.obj, constraints.state FROM actions
							LEFT JOIN action_to_constraint ON actions.ID = action_to_constraint.action
							LEFT JOIN constraints ON constraints.ID = action_to_constraint.constraint_
							WHERE actions.obj1 = ? AND actions.obj2 = ?
							ORDER BY actions.ID;`, [first_ID, item2[0].ID]);
						const result = satisfy_constraints(states, constraints, objects);
						if (result) {
							const effects = await query(`
								SELECT effects.obj, effects.state, effects.text FROM actions
								JOIN action_to_effect ON actions.ID = action_to_effect.action
								JOIN effects ON effects.ID = action_to_effect.effect
								WHERE actions.ID = ?;`, [result.ID]);
							const text = handle_effects(effects, objects, states);
							show(show_data, text ? text : "Nothing happens.");
						} else {
							show(show_data, "Nothing happens.");
						}
					} else {
						show(show_data, `There is no ${second_name} here`);
					}
				}
			} else {
				show(show_data, "Invalid command");
			}
		} else if (req.url == '/') {
			const result = await query(`SELECT name FROM games WHERE start IS NOT NULL ORDER BY name`);
			var game_list = "";
			for (const game of result) game_list += `<li><a href="/start?game=${encodeURIComponent(game.name)}">${sanitize(game.name)}</a></li>`;
			const file = await show_file('home-page.html', game_list);
			res.end(file);
		} else if (parsed_url.pathname == '/start') {
			const name = parsed_url.query.game;
			const result = await query(`
				SELECT locations.ID, locations.description FROM games
				JOIN locations ON locations.ID = games.start WHERE games.name = ?`, [name]);
			const file = await show_file('play.html',
				sanitize(name),
				sanitize(result[0].description),
				"", result[0].ID, "", "");
			res.end(file);
		} else if (req.url == '/edit') {
			const result = await query(`SELECT name, ID FROM games ORDER BY name`);
			var game_list = "";
			for (const game of result) game_list += `<option>${sanitize(game.name)}</option>`;
			const file = await show_file('choose-edit.html', game_list);
			res.end(file);
		} else if (parsed_url.pathname == '/edit' && parsed_url.query.game) {
			const game = await query(`SELECT * FROM games WHERE name = ?`,	[parsed_url.query.game]);
			const locations = await query(`SELECT * FROM locations WHERE game = ?`, [game[0].ID]);
			var location_list = "";
			for (const location of locations) location_list += game[0].start == location.ID ? `
				<li id="${location.ID}" class="start">
					<span onclick="expand(this.parentElement)">${sanitize(location.name)}</span>&emsp;
					<button onclick="remove(this.parentElement)">delete</button>&emsp;
				</li>
				` : `
				<li id="${location.ID}">
					<span onclick="expand(this.parentElement)">${sanitize(location.name)}</span>&emsp;
					<button onclick="remove(this.parentElement)">delete</button>&emsp;
					<button onclick="make_start(this.parentElement)">make start</button>
				</li>
				`;
			const objects = await query(`SELECT * FROM objects WHERE location IS NULL AND game = ?`, [game[0].ID]);
			var obj_list = "";
			for (const obj of objects) obj_list += `
				<li id="${obj.ID}">
					<span onclick="expand(this.parentElement)">${sanitize(obj.name)}</span>&emsp;
					<button onclick='remove(this.parentElement)'>delete</button>
				</li>`;
			const file = await show_file('edit.html',
				location_list,
				obj_list,
				game[0].ID);
			res.end(file);
		} else if (req.url == '/new') {
			const file = await show_file('new-game.html');
			res.end(file);
		} else if (req.url == '/create' && req.method == 'POST') {
			var data = "";
			req.on('data', chunk => data += chunk);
			req.on('end', async () => {
				data = url.parse('?' + data, true).query.name;
				try {
					await query(`INSERT INTO games (name) values (?)`, [data]);
					res.setHeader('Location', `/edit?game=${data}`);
				} catch (error) {
					res.setHeader('Location', `/edit`);
					console.error(error);
				} finally {
					res.statusCode = 302;
					res.end();
				}
			});
		} else if (parsed_url.pathname == '/expand') {
			switch (parsed_url.query.type) {
				case "location":
					var result = await query(`SELECT name, ID FROM objects WHERE location = ?`, [parsed_url.query.id]);
					res.write(`<ul class="object"><button onclick='add(this.parentElement)'>Add an object</button>`);
					for (const obj of result)
						res.write(`
							<li id="${obj.ID}">
								<span onclick="expand(this.parentElement)">${sanitize(obj.name)}</span>&emsp;
								<button onclick='remove(this.parentElement)'>delete</button>
							</li>`);
					res.end(`</ul>`);
					break;
				case "object":
					var result = await query(`
						SELECT * FROM actions
						JOIN objects ON actions.obj1 = objects.ID OR actions.obj1
						WHERE actions.obj1 = ? OR obj2 = ?`,
						[parsed_url.query.id, parsed_url.query.id]);
					res.write(`<ul class="action"><button onclick='add(this.parentElement)'>Add an action</button>`);
					for (const action of result)
						res.write(`
							<li id="${action.ID}">
								<span onclick="expand(this.parentElement)">
									use ${sanitize(action.obj1)}${action.obj2 ? ` on ${sanitize(action.obj2)}` : ''}
								</span>&emsp;<button onclick='remove(this.parentElement)'>delete</button>
							</li>`);
					res.end(`</ul>`);
					break;
				default: invalid_request(res);
			}
		} else if (parsed_url.pathname == '/remove') {
			switch (parsed_url.query.type) {
				case "game":
					await query(`DELETE FROM games WHERE ID = ?`, [parsed_url.query.game]);
					res.statusCode = 410;
					res.end();
					break;
				case "location":
					await query(`DELETE FROM locations WHERE ID = ? AND game = ?`,
						[parsed_url.query.id, parsed_url.query.game]);
					res.statusCode = 202;
					res.end();
					break;
				case "object":
					await query(`DELETE FROM objects WHERE ID = ? AND game = ?`,
						[parsed_url.query.id, parsed_url.query.game]);
					res.statusCode = 202;
					res.end();
					break;
				default: invalid_request(res);
			}
		} else if (req.url == '/add') {
			var data = "";
			req.on('data', chunk => data += chunk);
			req.on('end', async () => {
				data = url.parse('?' + data, true).query;
				switch (data.type) {
					case "location":
						var result = await query(`INSERT INTO locations (game, name, description) values (?,?,?)`,
							[data.game, data.name, data.description]);
						res.statusCode = 200;
						const file = await show_file('location-item.html',
							result.insertID,
							sanitize(data.name));
						res.end(file);
						break;
					case "object":
						var result = await query(`INSERT INTO objects (game, name, location) values (?,?,?)`,
							[data.game, data.name, data.location]);
						res.end(`
							<li id="${result.insertID}">
								<span onclick="expand(this.parentElement)">${sanitize(data.name)}</span>&emsp;
								<button onclick='remove(this.parentElement)'>delete</button>
							</li>`);
						break;					
					default: invalid_request(res);
				}
			});
		} else if (req.url == '/setstart') {
			var data = "";
			req.on('data', chunk => data += chunk);
			req.on('end', async () => {
				data = url.parse('?' + data, true).query;
				await query(`UPDATE games SET start = ? WHERE ID = ?`, [data.id, data.game]);
				res.statusCode = 202;
				res.end();
			});
		} else {
			res.statusCode = 404;
			const file = await show_file('404.html');
			res.end(file);
		}
	} catch (error) {
		invalid_request(res);
		console.error(error);
	}
}).listen(port);

function handle_effects(effects, objects, states) {
	var text = "";
	effects.forEach(function (effect, index) {
		if (effect.state) states[objects.findIndex((obj) => obj.ID == effect.obj)] = effect.state;
		if (effect.text) text += (index == 0 ? "" : " ") + effect.text;
	});
	return text;
}

function satisfy_constraints(states, constraints, objects) {
	var current_ID,
		valid = false;
	for (const constraint of constraints) {
		if (constraint.obj == null) return constraint;
		if (constraint.ID != current_ID) {
			if (valid) return valid;
			valid = constraint;
			current_ID = constraint.ID;
		}
		if (states[objects.findIndex((obj) => obj.ID == constraint.obj)] != constraint.state) valid = false;
	}
	return valid;
}

async function show(data, text) {
	const result = await query(`SELECT name FROM games WHERE ID = ?`, [data.game]);
	if (data.inventory.length == 0) {
		const file = await show_file('play.html', 
			sanitize(result[0].name),
			sanitize(text),
			toHexString(data.states),
			data.location, "", "");
		data.res.end(file);
	} else {
		const inventory = await query(`SELECT name FROM objects WHERE ID IN (?)`, [data.inventory]);
		var objects = "";
		inventory.forEach((item, index) => 
			objects += ((index == 0 ? "" : ", ") + item.name)
		);
		const file = await show_file('play.html',
			sanitize(result[0].name),
			sanitize(text),
			toHexString(data.states),
			data.location,
			data.inventory.join(' '),
			`<p>You have: ${sanitize(objects)}</p>`
		);
		res.end(file);
	}		
}

function invalid_request(res) {
	res.statusCode = 400;
	show_file('invalid-request.html').then(res.end, err => {throw err;});
}

async function show_file(path) {
	path = await files.get(path);
	return util.format.apply(null, arguments);
}

function parse_literals(string, object) {
	return string.replace(/{{ \w+ }}/g, item => object[item.replace(/{{ (\w+) }}/, '$1')]);
}

function sanitize(str) {
	return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toHexString(halfByteArray) {
	for (var i = 0; i < halfByteArray.length; i++) {
		if (halfByteArray[i] == undefined) halfByteArray[i] = 0;
	}
	return halfByteArray.map(function(byte) {
		return ('0' + (byte & 0xF).toString(16)).slice(-1);
	}).join('');
}
function toHalfByteArray(hexString) {
	if (typeof hexString == 'string') {
		var result = [];
		for (var i = 0; i < hexString.length; i += 1) {
			result.push(parseInt(hexString.substr(i, 1), 16));
		}
		return result;
	}
}

function a_an(string) {
	return /^[aeiou]/i.test(string) ? `an ${string}` : `a ${string}`;
}