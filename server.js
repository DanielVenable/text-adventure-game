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
	const command = decodeURIComponent(req.url.split('&')[0].split('cmd=')[1]);
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
							function(err, constraint){
								if (err) throw err;
								
							});	
						}
					});
				} else if (command.startsWith('pick up ')) {

				} else if (command.startsWith('use ')) {

				} else {
					
				}
			}
		});
	//}
});