const http = require('http');
const mysql = require('mysql');
const url = require('url');
const fs = require('fs');
const port = 8000;

var sql = mysql.createConnection({
	host: "localhost",
	user: "text_adventure_game",
	password: "D8T3tcHE~td03;[)jftvi <+3",
	database: "text_adventure_games"
});

sql.connect(function(err) {
	if (err) throw err;
	server.listen(port, () => {
		console.log(`Server running at http://localhost:${port}/`);
	});
});

const server = http.createServer((req, res) => {
	res.setHeader('Content-Type', 'text/html');
	res.statusCode = 200;
	const parsed_url = url.parse(req.url, true);
	if (parsed_url.pathname == "/play") {
		const command = parsed_url.query.cmd;
		const states = toHalfByteArray(parsed_url.query.a);
		const locationID = parsed_url.query.b;
		var inventory = parsed_url.query.c;
		if ([command, states, locationID, inventory].every(a => a !== undefined)) {
			inventory = inventory.split(' ').map(parseInt).filter(elem => !isNaN(elem));
			sql.query(`SELECT * FROM locations WHERE ID = ?;`, [locationID], function (err, location) {
				if (err) throw err;
				if (location.length == 1) {
					const show_data = {
						res:res, game:location[0].game, states:states, location:locationID, inventory:inventory
					};
					sql.query(`SELECT * FROM objects WHERE game = ? ORDER BY ID`, [location[0].game],
					function (err, objects) {
						if (err) throw err;
						if (command.startsWith('go to ')) {
							sql.query(`SELECT ID, description FROM locations WHERE name = ? AND game = ?;`,
								[command.split(/^go to /)[1], location[0].game],
							function (err, end_location) {
								if (err) throw err;
								if (end_location.length == 1) {
									sql.query(`
										SELECT paths.ID, constraints.obj, constraints.state FROM paths
										LEFT JOIN path_to_constraint ON paths.ID = path_to_constraint.path
										LEFT JOIN constraints ON constraints.ID = path_to_constraint.constraint_
										WHERE paths.start = ? AND paths.end = ?
										ORDER BY paths.ID;`,
									[location[0].ID, end_location[0].ID],
									function(err, constraints){
										if (err) throw err;
										const result = satisfy_constraints(states, constraints, objects);
										if (result) {
											sql.query(`
												SELECT effects.obj, effects.state, effects.text FROM paths
												JOIN path_to_effect ON paths.ID = path_to_effect.path
												JOIN effects ON effects.ID = path_to_effect.effect
												WHERE paths.start = ? AND paths.end = ?`,
											[location[0].ID, end_location[0].ID],
											function (err, effects) {
												if (err) throw err;
												const text = handle_effects(effects, objects, states);
												show_data.location = end_location[0].ID;
												show(show_data, end_location[0].description);
											});
										} else {
											show(show_data, "Nothing happens.");
										}
									});
								} else {
									show(show_data, 'Nothing happens.');
								}
							});
						} else if (command.startsWith('pick up ')) {
							const name = command.split(/^pick up /)[1];
							sql.query(`SELECT ID FROM objects WHERE name = ? AND game = ? AND default_location = ?;`,
								[name, location[0].game, locationID],
							function (err, obj) {
								if (err) throw err;
								if (obj.length == 1) {
									if (inventory.includes(obj[0].ID)) {
										show(show_data, "You already have it.");
									} else {
										sql.query(`
											SELECT grab.ID, grab.success, constraints.obj, constraints.state FROM grab
											LEFT JOIN grab_to_constraint ON grab.ID = grab_to_constraint.grab
											LEFT JOIN constraints ON constraints.ID = grab_to_constraint.constraint_
											WHERE grab.obj = ?
											ORDER BY grab.ID;`, [obj[0].ID],
										function(err, constraints){
											if (err) throw err;
											const result = satisfy_constraints(states, constraints, objects);
											if (result) {
												sql.query(`
													SELECT effects.obj, effects.state, effects.text FROM grab
													JOIN grab_to_effect ON grab.ID = grab_to_effect.grab
													JOIN effects ON effects.ID = grab_to_effect.effect
													WHERE grab.ID = ?`, [obj[0].ID],
												function (err, effects) {
													if (err) throw err;
													const text = handle_effects(effects, objects, states);
													if (result.success) {
														inventory.push(obj[0].ID);
														show(show_data, `${text ? text + ' ' : ''}You have ${a_an(name)}.`);
													} else {
														show(show_data, text ? text : "Nothing happens.");
													}
												});
											} else {
												show(show_data, "Nothing happens.");
											}
										});
									}
								} else {
									show(show_data, `There is no ${name} here.`);
								}
							});
						} else if (/^use .+/.test(command)) {
							const objs = command.split(/^use /)[1].split(' on ');
							if (objs[1] === undefined) {
								use_on(null, objs[0]);
							} else {
								sql.query(`SELECT ID FROM objects WHERE name = ?`, [objs[0]], function (err, item1) {
									if (err) throw err;
									if (item1.length == 1 && inventory.includes(item1[0].ID)) {
										use_on(item1[0].ID, objs[1]);
									} else {
										show(show_data, `You don't have ${a_an(objs[0])}`);
									}
								});
							}
							function use_on(first_ID, second_name) {
								sql.query(`SELECT ID, default_location FROM objects WHERE name = ?`, [second_name],
								function (err, item2) {
									if (err) throw err;
									var valid_items = [];
									item2.forEach(function (item) {
										if (item.default_location == locationID || inventory.includes(item.ID)) {
											valid_items.push(item);
										}
									});
									if (valid_items.length == 1) {
										sql.query(`
											SELECT actions.ID, constraints.obj, constraints.state FROM actions
											LEFT JOIN action_to_constraint ON actions.ID = action_to_constraint.action
											LEFT JOIN constraints ON constraints.ID = action_to_constraint.constraint_
											WHERE actions.obj1 = ? AND actions.obj2 = ?
											ORDER BY actions.ID;`, [first_ID, item2[0].ID],
										function(err, constraints){
											if (err) throw err;
											const result = satisfy_constraints(states, constraints, objects);
											if (result) {
												sql.query(`
													SELECT effects.obj, effects.state, effects.text FROM actions
													JOIN action_to_effect ON actions.ID = action_to_effect.action
													JOIN effects ON effects.ID = action_to_effect.effect
													WHERE actions.ID = ?;`, [result.ID],
												function (err, effects) {
													if (err) throw err;
													const text = handle_effects(effects, objects, states);
													show(show_data, text ? text : "Nothing happens.");
												});
											} else {
												show(show_data, "Nothing happens.");
											}
										});
									} else {
										show(show_data, `There is no ${second_name} here`);
									}
								});
							}
						} else {
							show(show_data, "Invalid command");
						}
					});
				} else {
					invalid_request(res);
				}
			});
		} else {
			invalid_request(res);
		}
	} else if (req.url == '/') {
		sql.query(`SELECT name FROM games WHERE start IS NOT NULL ORDER BY name;`, function (err, result) {
			if (err) throw err;
			var game_list = "";
			result.forEach(function (game) {
				game_list += `<li><a href="/start?game=${encodeURIComponent(game.name)}">${sanitize(game.name)}</a></li>`;
			});
			res.end(`
				<html><head><title>Text adventure game</title></head>
				<body><h3>Choose a game to play:</h3><ul>${game_list}</ul>
				<h3>Or <a href="/edit">edit a game</a>.</h3>
				<h3>Or <a href="/new">make your own game</h3></body></html>
			`);
		});
	} else if (parsed_url.pathname == '/start') {
		const name = parsed_url.query.game;
		sql.query(`SELECT locations.ID, locations.description FROM games JOIN locations ON locations.ID = games.start WHERE games.name = ?`,
		[name], function (err, result) {
			if (err) throw err;
			if (result.length == 1) {
				res.end(`
					<html><head><title>${sanitize(name)} | text adventure games</title></head>
					<body><p>${sanitize(result[0].description)}</p><form method="get" action="/play">
					<input onkeypress="if (event.key == 'Enter') this.parentElement.submit();" name="cmd"/>
					<input hidden name="a"/>
					<input hidden value="${result[0].ID}" name="b"/>
					<input hidden name="c"/>
					<input type="submit"></form>
					</body></html> 
				`);
			}
		});
	} else if (req.url == '/edit') {
		sql.query(`SELECT name, ID FROM games ORDER BY name;`, function (err, result) {
			if (err) throw err;
			var game_list = "";
			result.forEach(game => game_list += `<option>${sanitize(game.name)}</option>`);
			res.end(`
				<html><head><title>text adventure game</title></head>
				<body><form>
					<label>Choose a game to edit: <select name="game">${game_list}</select></label><br>
					<input type="submit">
				</form></body></html>
			`);
		});
	} else if (parsed_url.pathname == '/edit' && parsed_url.query.game) {
		sql.query(`SELECT * FROM games WHERE name = ?`,	[parsed_url.query.game], (err, game) => {
			if (err) throw err;
			if (game.length == 1) {
				sql.query(`SELECT * FROM locations WHERE game = ?`, [game[0].ID], (err, locations) => {
					if (err) throw err;
					var location_list = "";
					locations.forEach(location => location_list += `
						<li id="${location.ID}">
							<span onclick="expand(this.parentElement)">${sanitize(location.name)}</span>&emsp;
							<button onclick="remove(this.parentElement)">delete</button>&emsp;
							${game[0].default_location == location.ID ? "" :
							`<button onclick="make_default(this.parentElement)">make default</button>`}
						</li>
					`);
					res.end(`
						<html><head><title>text adventure game</title><style>
						span {
							cursor: pointer;
							text-decoration: underline;
						}
						button {
							padding: 0px 0px;
						}
						li {
							line-height: 300%
						}
						</style></head><body class="game">
						<p>Locations</p>
						<ul class="location">
						<button onclick='add(this.parentElement)'>Add a location</button>
						${location_list}</ul>
						<button onclick='remove(this)'>Delete this game</button>
						</body><script>
						const game = ${game[0].ID};
						var opened = new Set();
						function expand(element) {
							if (opened.has(element)) {
								element.innerHTML = element.innerHTML.split("<ul")[0];
								opened.delete(element);
							} else {
								opened.add(element);
								const xhttp = new XMLHttpRequest();
								xhttp.onreadystatechange = function() {
									if (this.readyState == 4 && this.status == 200) element.innerHTML += this.responseText;
								}	
								xhttp.open("GET", 
									"/expand?game=" + encodeURIComponent(game) + 
									"&type=" + element.parentElement.className +
									"&id=" + element.id, true);
								xhttp.send();
							}
						}

						function add(element) {
							const xhttp = new XMLHttpRequest();
							xhttp.onreadystatechange = function() {
								if (this.readyState == 4 && this.status == 200) element.innerHTML += this.responseText;
							}
							xhttp.open("POST", "/add", true);
							const name = encodeURIComponent(prompt("Choose a name for the location.", ""));
							if (name == "null" || name == "") return;
							const description = encodeURIComponent(prompt("Choose a description for the loctation.", ""));
							if (description == "null" || description == "") return;
							xhttp.send(
								"game=" + encodeURIComponent(game) +
								"&type=" + element.className +
								"&name=" + name +
								"&description=" + description);
						}

						function remove(element) {
							var text = 
								"Are you sure you want to delete this " +
								element.parentElement.className + "? This operation cannot be undone";
							if (confirm(text)) {
								const xhttp = new XMLHttpRequest();
								xhttp.onreadystatechange = function() {
									if (this.readyState == 4) {
										if (this.status == 202) {
											element.remove();
										} else if (this.status == 410) {
											window.location.replace("/");
										} 
									}
								}
								xhttp.open("DELETE", 
									"/remove?game=" + encodeURIComponent(game) + 
									"&type=" + element.parentElement.className +
									"&id=" + element.id, true);
								xhttp.send();
							}
						}

						function make_default(element) {
							const xhttp = new XMLHttpRequest();
							xhttp.onreadystatechange = function() {
								if (this.readyState == 4 && this.status == 202) {
									
								}
							}
							xhttp.open()
						}
						</script></html>
					`);
				});
			} else {
				invalid_request(res);
			}
		});
	} else if (req.url == '/new') {
		res.end(`
			<html><head><title>text adventure game</title></head>
			<body><form method="POST" action="/create"
				<p>Choose a name for your game:</p><input name="name">
				<input type="submit">
			</form></body></html>
		`);
	} else if (req.url == '/create' && req.method == 'POST') {
		var data = "";
		req.on('data', chunk => data += chunk);
		req.on('end', () => {
			data = url.parse('?' + data, true).query.name;
			if (data) sql.query(`INSERT INTO games (name) values (?)`, [data], err => {
				if (err) {
					res.setHeader('Location', `/edit`);
				} else {
					res.setHeader('Location', `/edit?game=${data}`);
				}
				res.statusCode = 302;
				res.end();
			});
		});
	} else if (parsed_url.pathname == '/expand') {
		switch (parsed_url.query.type) {
			case "location":
				sql.query(`SELECT name, ID FROM objects WHERE default_location = ?`,
				[parsed_url.query.id], (err, result) => {
					if (err) throw err;
					res.write(`<ul class="object"><button onclick='add(this.parentElement)'>Add an object</button>`);
					for (const obj of result) {
						res.write(`
							<li id="${obj.ID}">
								<span onclick="expand(this.parentElement)">${sanitize(obj.name)}</span>&emsp;
								<button onclick='remove(this.parentElement)'>delete</button>
							</li>`);
					}
					res.end(`</ul>`);
				});
				break;
			case "object":
				sql.query(`SELECT * FROM actions JOIN objects ON actions.obj1 = objects.ID OR actions.obj1 WHERE actions.obj1 = ? OR obj2 = ?`,
				[parsed_url.query.id, parsed_url.query.id], (err, result) => {
					if (err) throw err;
					res.write(`<ul class="action">`);
					for (const action of result) {
						res.write(`
							<li id="${action.ID}">
								<span onclick="expand(this.parentElement)">
									use ${sanitize(action.obj1)}${action.obj2 ? ` on ${sanitize(action.obj2)}` : ''}
								</span>&emsp;<button onclick='remove(this.parentElement)'>delete</button>
							</li>`);
					}
					res.end(`</ul>`);
				});
				break;
			default: invalid_request(res);
		}
	} else if (parsed_url.pathname == '/remove') {
		switch (parsed_url.query.type) {
			case "game":
				sql.query(`DELETE FROM games WHERE ID = ?`, [parsed_url.query.game], err => {
					if (err) throw err;
					res.statusCode = 410;
					res.end();
				});
				break;
			case "location":
				sql.query(`DELETE FROM locations WHERE ID = ? AND game = ?`,
				[parsed_url.query.id, parsed_url.query.game], err => {
					if (err) throw err;
					console.log(parsed_url);
					res.statusCode = 202;
					res.end();
				});
				break;
			case "object":
				sql.query(`DELETE FROM objects WHERE ID = ? AND game = ?`,
				[parsed_url.query.id, parsed_url.query.game], err => {
					if (err) throw err;
					res.statusCode = 202;
					res.end();
				});
				break;
			default: invalid_request(res);
		}
	} else if (req.url == '/add') {
		var data = "";
		req.on('data', chunk => data += chunk);
		req.on('end', () => {
			data = url.parse('?' + data, true).query;
			switch (data.type) {
				case "location":
					sql.query(`INSERT INTO locations (game, name, description) values (?,?,?)`,
					[data.game, data.name, data.description], (err, result) => {
						if (err) {
							invalid_request(res);
						} else {
							res.statusCode = 200;
							res.end(`
								<li id="${result.insertID}">
								<span onclick="expand(this.parentElement)">${sanitize(data.name)}</span>&emsp;
								<button onclick='remove(this.parentElement)'>delete</button>
								</li>
							`);
						}
					});
					break;
				case "object":
					sql.query(`INSERT INTO objects (game, name, default_location) values (?,?,?)`,
					[data.game, data.name, data.description], (err, result) => {
						if (err) {
							invalid_request(res);
						} else {
							
						}
					});
				default: invalid_request(res);
			}
		});		
	} else {
		res.statusCode = 404;
		res.end(`<html><head><title>404</title></head>
			<body><p>Sorry, but this page does not exist. Click <a href="/">here</a> to go home.</p></body></html>`);	
	}
});

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
	for (var i = 0; i < constraints.length; i++) {
		if (constraints[i].obj == null) {
			return constraints[i];
		}
		if (constraints[i].ID != current_ID) {
			if (valid) return valid;
			valid = constraints[i];
			current_ID = constraints[i].ID;
		}
		if (states[objects.findIndex((obj) => obj.ID == constraints[i].obj)] != constraints[i].state) {
			valid = false;
		}
	}
	return valid;
}

function show(data, text) {
	sql.query(`SELECT name FROM games WHERE ID = ?`, [data.game], function (err, result) {
		if (err) throw err;
		if (result.length == 1) {
			if (data.inventory.length == 0) {
				data.res.end(`
					<html><head><title>${sanitize(result[0].name)} | text adventure games</title></head>
					<body><p>${sanitize(text)}</p><form method="get">
					<input onkeypress="if (event.key == 'Enter') this.parentElement.submit();" name="cmd"/>
					<input hidden value="${toHexString(data.states)}" name="a"/>
					<input hidden value="${data.location}" name="b"/>
					<input hidden value="${toHexString(data.inventory)}" name="c"/>
					<input type="submit"></form></body></html> 
				`);
			} else {
				sql.query(`SELECT name FROM objects WHERE ID IN (?)`, [data.inventory], function (err, inventory) {
					if (err) throw err;
					var objects = "";
					inventory.forEach(function (item, index) {
						objects += ((index == 0 ? "" : ", ") + item.name);
					});
					data.res.end(`
						<html><head><title>${sanitize(result[0].name)} | text adventure games</title></head>
						<body><p>${sanitize(text)}</p><form method="get">
						<input onkeypress="if (event.key == 'Enter') this.parentElement.submit();" name="cmd"/>
						<input hidden value="${toHexString(data.states)}" name="a"/>
						<input hidden value="${data.location}" name="b"/>
						<input hidden value="${data.inventory.join(' ')}" name="c"/>
						<input type="submit"></form>
						<p>You have: ${sanitize(objects)}</p></body></html> 
					`);
				});
			}
		}
	});
}

function invalid_request(res) {
	res.statusCode = 400;
	res.end(`
		<html><head><title>Oops</title></head>
		<body><p>Sorry, but the request is invalid. Click <a href="/">here</a> to go home.</p></body></html>
	`);
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

function parse_literals(string, object) {
	return string.replace(/{{ \w+ }}/g, item => object[item.replace(/{{ (\w+) }}/, '$1')]);
}