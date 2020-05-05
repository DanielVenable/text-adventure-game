const http = require('http');
const mysql = require('mysql');
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
	res.statusCode = 200;
	res.setHeader('Content-Type', 'text/html');
	const split_url = req.url.split('?');
	if (split_url.length == 2 && split_url[0] == "/play") {
		const split_request = split_url[1].split('&');
		if (split_request.length == 4) {
			const command = decodeURIComponent(split_request[0].split('=')[1].replace(/\+/g, " "));
			const states = toByteArray(split_request[1].split('=')[1]);
			const locationID = parseInt(split_request[2].split('=')[1]);
			const inventory = toByteArray(split_request[3].split('=')[1]);
			if (command && states && locationID && inventory) {
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
									[command.split('go to ')[1], location[0].game],
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
											if (satisfy_constraints(states, constraints)) {
												show_data.location = end_location[0].ID;
												show(show_data, end_location[0].description);
											} else {
												show(show_data, 'Nothing happens.');
											}
										});
									} else {
										show(show_data, 'Nothing happens.');
									}
								});
							} else if (command.startsWith('pick up ')) {
								sql.query(`SELECT ID FROM objects WHERE name = ? AND game = ? AND default_location = ?;`,
									[command.split('pick up ')[1], location[0].game, location],
								function (err, obj) {
									if (err) throw err;
									if (obj.length == 1) {
										sql.query(`
											SELECT grab.ID, grab.success, constraints.obj, constraints.state FROM grab
											LEFT JOIN grab_to_constraint ON grab.ID = grab_to_constraint.grab
											LEFT JOIN constraints ON constraints.ID = grab_to_constraint.constraint_
											WHERE grab.obj = ?
											ORDER BY grab.ID;`, [obj[0].ID],
										function(err, constraints){
											if (err) throw err;
											const result = satisfy_constraints(states, constraints);
											if (result) {
												if (result.success) {
													show_data.inventory.push(obj[0]);
													show(show_data, `You have a ${obj}.`);
												}
											} else {
												show(show_data, 'Nothing happens.');
											}
										});
									} else {
										show(show_data, 'Nothing happens.');
									}
								});
							} else if (command.startsWith('use ')) {

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
		} else {
			invalid_request(res);
		}
	}
});

function satisfy_constraints(states, constraints) {
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
		if (states[constraints[i].obj] != constraints[i].state) {
			valid = false;
		}
	}
	return valid;
}

function show(data, text) {
	sql.query(`SELECT name FROM games WHERE ID = ?`, [data.game], function (err, result) {
		if (err) throw err;
		if (result.length == 1) {
			data.res.end(`
				<html><head><title>${sanitize(result[0].name)} | text adventure games</title></head>
				<body><p>${sanitize(text)}</p><form method="get">
				<input onkeypress="if (event.key == 'Enter') this.parentElement.submit();" name="cmd"/>
				<input hidden value="${toHexString(data.states)}" name="a"/>
				<input hidden value="${data.location}" name="b"/>
				<input hidden value="${toHexString(data.inventory)}" name="c"/></form></body></html>
			`);
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

function toHexString(byteArray) {
	return Array.prototype.map.call(byteArray, function(byte) {
		return ('0' + (byte & 0xFF).toString(16)).slice(-2);
	}).join('');
}
function toByteArray(hexString) {
	var result = [];
	for (var i = 0; i < hexString.length; i += 2) {
		result.push(parseInt(hexString.substr(i, 2), 16));
	}
	return result;
}