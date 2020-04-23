const http = require('http');
const mysql = require('mysql');
const sqlstring = require('sqlstring');
const port = 8080;

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
	const url = decodeURIComponent(req.url);
	res.setHeader('Content-Type', 'text/html'); 
});