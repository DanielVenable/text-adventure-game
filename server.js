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
	const split_url = req.url.split('?');
	if (split_url.length == 1 && split_url[0] == "/play") {
		const split_request = split_url[1].split('&');
		const command = decodeURIComponent(split_request[0].split('cmd=')[1]);
		/*
		const location = parseInt(   );
		if (locationID) {
			const states = ;
			const inventory = ;*/
			res.setHeader('Content-Type', 'text/html');
			sql.query(`SELECT * FROM locations WHERE ID = ?;`, [locationID], function (err, location) {
				if (err) throw err;
				if (location.length == 1) {
					if (command.startsWith('go to ')) {
						sql.query(`SELECT ID, description FROM locations WHERE name = ? AND game = ?;`,
							[command.split('go to ')[1], location[0].game],
						function (err, end_location) {
							if (err) throw err;
							if (end_location.length == 1) {
								sql.query(`
									SELECT path.ID, path_constraints.obj, path_constraints.state FROM paths
									JOIN path_to_constraint ON paths.ID = path_to_constraint.path
									JOIN path_constraints ON path_constraints.ID = path_to_constraint.constraint_
									WHERE paths.start = ? AND paths.end = ?
									ORDER BY path.ID;`,
								[location[0].ID, end_location[0].ID],
								function(err, constraints){
									if (err) throw err;
									if (satisfy_constraints(url, constraints)) {
										show(res, location[0].game, end_location[0].description);
									} else {
										show(res, location[0].game, 'Nothing happens.');
									}
								});	
							} else {
								show(res, location[0].game, 'Nothing happens.');
							}
						});
					} else if (command.startsWith('pick up ')) {

					} else if (command.startsWith('use ')) {

					} else {
						
					}
				}
			});
		//}
	}
});

function satisfy_constraints(url, constraints) {
	var current_ID,
		valid = true;
	for (var i = 0; i < constraints.length; i++) {
		if (constraints[i].ID != current_ID) {
			if (valid) return true;
			valid = true;
			current_ID = constraints[i].ID;
		}
		if (!satisfy_constraint(url, constraints[i])) {
			valid = false;
		}
	}
	return valid;
}

function satisfy_constraint(url, constraint) {

}

function show(res, game, text) {
	sql.query(`SELECT name FROM games WHERE ID = ?`, [game], function (err, result) {
		if (err) throw err;
		if (result.length == 1) {
			res.end(`
				<html><head><title>${sanitize(result[0].name)} | text adventure games</title></head>
				<body><p>${sanitize(text)}</p><form method="get"><input name="cmd"/></form></body></html>
			`);
		}
	});
}

function sanitize(str) {
	return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}