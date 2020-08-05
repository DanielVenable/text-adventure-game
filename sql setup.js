const sql = require('mysql').createConnection({
	multipleStatements: true,
	host: "localhost",
	user: "text_adventure_game",
	password: require('fs').readFileSync(__dirname + '/password.txt').toString(),
	database: "text_adventure_games"
});

sql.connect();
sql.query(`
	SET FOREIGN_KEY_CHECKS = 0;

	CREATE TABLE IF NOT EXISTS users (
		ID int unsigned NOT NULL AUTO_INCREMENT,
		username varchar(255) NOT NULL,
		hash char(64) NOT NULL,
		PRIMARY KEY (ID),
		UNIQUE KEY username (username));

	CREATE TABLE IF NOT EXISTS games (
		ID int unsigned NOT NULL AUTO_INCREMENT,
		name varchar(255) NOT NULL,
		text varchar(255) NOT NULL DEFAULT "",
		start int unsigned,
		public tinyint(1) DEFAULT 0,
		PRIMARY KEY (ID),
		UNIQUE KEY name (name),
		FOREIGN KEY (start) REFERENCES locations (ID) ON DELETE SET NULL);

	CREATE TABLE IF NOT EXISTS user_to_game (
		user int unsigned NOT NULL,
		game int unsigned NOT NULL,
		permission tinyint unsigned NOT NULL DEFAULT 0,
		FOREIGN KEY (user) REFERENCES users (ID) ON DELETE CASCADE,
		FOREIGN KEY (game) REFERENCES games (ID) ON DELETE CASCADE);

	CREATE TABLE IF NOT EXISTS locations (
		ID int unsigned NOT NULL AUTO_INCREMENT,
		game int unsigned NOT NULL,
		name varchar(255) NOT NULL,
		PRIMARY KEY (ID),
		FOREIGN KEY (game) REFERENCES games (ID) ON DELETE CASCADE);

	CREATE TABLE IF NOT EXISTS descriptions (
		ID int unsigned NOT NULL AUTO_INCREMENT,
		location int unsigned NOT NULL,
		num int unsigned NOT NULL,
		text varchar(255) NOT NULL DEFAULT "",
		PRIMARY KEY (ID),
		FOREIGN KEY (location) REFERENCES locations (ID) ON DELETE CASCADE);

	CREATE TABLE IF NOT EXISTS description_to_constraint (
		description int unsigned NOT NULL,
		constraint_ int unsigned NOT NULL,
		FOREIGN KEY (description) REFERENCES descriptions (ID) ON DELETE CASCADE,
		FOREIGN KEY (constraint_) REFERENCES constraint_and_effect (ID));

	CREATE TABLE IF NOT EXISTS description_to_location_constraint (
		description int unsigned NOT NULL,
		constraint_ int unsigned NOT NULL,
		FOREIGN KEY (description) REFERENCES descriptions (ID) ON DELETE CASCADE,
		FOREIGN KEY (constraint_) REFERENCES location_constraint_and_effect (ID));

	CREATE TABLE IF NOT EXISTS description_to_inventory_constraint (
		description int unsigned NOT NULL,
		obj int unsigned NOT NULL,
		have_it int unsigned NOT NULL,
		FOREIGN KEY (description) REFERENCES descriptions (ID) ON DELETE CASCADE,
		FOREIGN KEY (obj) REFERENCES objects (ID) ON DELETE CASCADE);

	CREATE TABLE IF NOT EXISTS paths (
		ID int unsigned NOT NULL AUTO_INCREMENT,
		start int unsigned NOT NULL,
		end int unsigned,
		game int unsigned NOT NULL,
		text varchar(255) DEFAULT "",
		PRIMARY KEY (ID),
		FOREIGN KEY (start) REFERENCES locations (ID) ON DELETE CASCADE,
		FOREIGN KEY (end) REFERENCES locations (ID) ON DELETE CASCADE);

	CREATE TABLE IF NOT EXISTS objects (
		ID int unsigned NOT NULL AUTO_INCREMENT,
		name varchar(255) DEFAULT NULL,
		location int unsigned DEFAULT NULL,
		game int unsigned NOT NULL,
		PRIMARY KEY (ID),
		FOREIGN KEY (game) REFERENCES games (ID) ON DELETE CASCADE,
		FOREIGN KEY (location) REFERENCES locations (ID) ON DELETE SET NULL);

	CREATE TABLE IF NOT EXISTS actions (
		ID int unsigned NOT NULL AUTO_INCREMENT,
		obj1 int unsigned NOT NULL,
		obj2 int unsigned,
		text varchar(255) DEFAULT "",
		PRIMARY KEY (ID),
		FOREIGN KEY (obj1) REFERENCES objects (ID) ON DELETE CASCADE,
		FOREIGN KEY (obj2) REFERENCES objects (ID) ON DELETE CASCADE);

	CREATE TABLE IF NOT EXISTS grab (
		ID int unsigned NOT NULL AUTO_INCREMENT,
		obj int unsigned NOT NULL,
		success boolean NOT NULL DEFAULT true,
		text varchar(255) DEFAULT "",
		PRIMARY KEY (ID),
		FOREIGN KEY (obj) REFERENCES objects (ID) ON DELETE CASCADE);

	CREATE TABLE IF NOT EXISTS constraint_and_effect (
		ID int unsigned NOT NULL AUTO_INCREMENT,
		obj int unsigned NOT NULL,
		state tinyint unsigned NOT NULL,
		PRIMARY KEY (ID),
		FOREIGN KEY (obj) REFERENCES objects (ID) ON DELETE CASCADE);

	CREATE TABLE IF NOT EXISTS grab_to_constraint (
		grab int unsigned NOT NULL,
		constraint_ int unsigned NOT NULL,
		FOREIGN KEY (grab) REFERENCES grab (ID) ON DELETE CASCADE,
		FOREIGN KEY (constraint_) REFERENCES constraint_and_effect (ID) ON DELETE CASCADE);

	CREATE TABLE IF NOT EXISTS grab_to_effect (
		grab int unsigned NOT NULL,
		effect int unsigned NOT NULL,
		FOREIGN KEY (grab) REFERENCES grab(ID) ON DELETE CASCADE,
		FOREIGN KEY (effect) REFERENCES constraint_and_effect (ID) ON DELETE CASCADE);

	CREATE TABLE IF NOT EXISTS path_to_constraint (
		path int unsigned NOT NULL,
		constraint_ int unsigned NOT NULL,
		FOREIGN KEY (path) REFERENCES paths(ID) ON DELETE CASCADE,
		FOREIGN KEY (constraint_) REFERENCES constraint_and_effect (ID) ON DELETE CASCADE);

	CREATE TABLE IF NOT EXISTS path_to_effect (
		path int unsigned NOT NULL,
		effect int unsigned NOT NULL,
		FOREIGN KEY (path) REFERENCES paths(ID) ON DELETE CASCADE,
		FOREIGN KEY (effect) REFERENCES constraint_and_effect (ID) ON DELETE CASCADE);

	CREATE TABLE IF NOT EXISTS action_to_constraint (
		action int unsigned NOT NULL,
		constraint_ int unsigned NOT NULL,
		FOREIGN KEY (action) REFERENCES actions (ID) ON DELETE CASCADE,
		FOREIGN KEY (constraint_) REFERENCES constraint_and_effect (ID) ON DELETE CASCADE);

	CREATE TABLE IF NOT EXISTS action_to_effect (
		action int unsigned NOT NULL,
		effect int unsigned NOT NULL,
		FOREIGN KEY (action) REFERENCES actions (ID) ON DELETE CASCADE,
		FOREIGN KEY (effect) REFERENCES constraint_and_effect (ID) ON DELETE CASCADE);

	CREATE TABLE IF NOT EXISTS location_constraint_and_effect (
		ID int unsigned NOT NULL AUTO_INCREMENT,
		obj int unsigned NOT NULL,
		location int unsigned,
		PRIMARY KEY (ID),
		FOREIGN KEY (obj) REFERENCES objects (ID) ON DELETE CASCADE,
		FOREIGN KEY (location) REFERENCES locations (ID) ON DELETE CASCADE);

	CREATE TABLE IF NOT EXISTS grab_to_location_constraint (
		grab int unsigned NOT NULL,
		constraint_ int unsigned NOT NULL,
		FOREIGN KEY (grab) REFERENCES grab (ID) ON DELETE CASCADE,
		FOREIGN KEY (constraint_) REFERENCES location_constraint_and_effect (ID) ON DELETE CASCADE);

	CREATE TABLE IF NOT EXISTS grab_to_location_effect (
		grab int unsigned NOT NULL,
		effect int unsigned NOT NULL,
		FOREIGN KEY (grab) REFERENCES grab(ID) ON DELETE CASCADE,
		FOREIGN KEY (effect) REFERENCES location_constraint_and_effect (ID) ON DELETE CASCADE);

	CREATE TABLE IF NOT EXISTS path_to_location_constraint (
		path int unsigned NOT NULL,
		constraint_ int unsigned NOT NULL,
		FOREIGN KEY (path) REFERENCES paths(ID) ON DELETE CASCADE,
		FOREIGN KEY (constraint_) REFERENCES location_constraint_and_effect (ID) ON DELETE CASCADE);

	CREATE TABLE IF NOT EXISTS path_to_location_effect (
		path int unsigned NOT NULL,
		effect int unsigned NOT NULL,
		FOREIGN KEY (path) REFERENCES paths(ID) ON DELETE CASCADE,
		FOREIGN KEY (effect) REFERENCES location_constraint_and_effect (ID) ON DELETE CASCADE);

	CREATE TABLE IF NOT EXISTS action_to_location_constraint (
		action int unsigned NOT NULL,
		constraint_ int unsigned NOT NULL,
		FOREIGN KEY (action) REFERENCES actions (ID) ON DELETE CASCADE,
		FOREIGN KEY (constraint_) REFERENCES location_constraint_and_effect (ID) ON DELETE CASCADE);

	CREATE TABLE IF NOT EXISTS action_to_location_effect (
		action int unsigned NOT NULL,
		effect int unsigned NOT NULL,
		FOREIGN KEY (action) REFERENCES actions (ID) ON DELETE CASCADE,
		FOREIGN KEY (effect) REFERENCES location_constraint_and_effect (ID) ON DELETE CASCADE);

	CREATE TABLE IF NOT EXISTS grab_to_inventory_constraint (
		grab int unsigned NOT NULL,
		obj int unsigned NOT NULL,
		have_it tinyint(1) unsigned NOT NULL,
		FOREIGN KEY (grab) REFERENCES grab (ID) ON DELETE CASCADE,
		FOREIGN KEY (obj) REFERENCES objects (ID) ON DELETE CASCADE);

	CREATE TABLE IF NOT EXISTS grab_to_inventory_effect (
		grab int unsigned NOT NULL,
		obj int unsigned NOT NULL,
		FOREIGN KEY (grab) REFERENCES grab (ID) ON DELETE CASCADE,
		FOREIGN KEY (obj) REFERENCES objects (ID) ON DELETE CASCADE);

	CREATE TABLE IF NOT EXISTS path_to_inventory_constraint (
		path int unsigned NOT NULL,
		obj int unsigned NOT NULL,
		have_it tinyint(1) unsigned NOT NULL,
		FOREIGN KEY (path) REFERENCES paths(ID) ON DELETE CASCADE,
		FOREIGN KEY (obj) REFERENCES objects (ID) ON DELETE CASCADE);

	CREATE TABLE IF NOT EXISTS path_to_inventory_effect (
		path int unsigned NOT NULL,
		obj int unsigned NOT NULL,
		FOREIGN KEY (path) REFERENCES paths(ID) ON DELETE CASCADE,
		FOREIGN KEY (obj) REFERENCES objects (ID) ON DELETE CASCADE);

	CREATE TABLE IF NOT EXISTS action_to_inventory_constraint (
		action int unsigned NOT NULL,
		obj int unsigned NOT NULL,
		have_it tinyint(1) unsigned NOT NULL,
		FOREIGN KEY (action) REFERENCES actions (ID) ON DELETE CASCADE,
		FOREIGN KEY (obj) REFERENCES objects (ID) ON DELETE CASCADE);

	CREATE TABLE IF NOT EXISTS action_to_inventory_effect (
		action int unsigned NOT NULL,
		obj int unsigned NOT NULL,
		FOREIGN KEY (action) REFERENCES actions (ID) ON DELETE CASCADE,
		FOREIGN KEY (obj) REFERENCES objects (ID) ON DELETE CASCADE);

	SET FOREIGN_KEY_CHECKS = 1;
`, err => {
	if (err) throw err;
	console.log('successfully created tables');
	process.exit(0);
});