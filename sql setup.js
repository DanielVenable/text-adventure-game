var sql = require('mysql').createConnection({
    multipleStatements: true,
	host: "localhost",
	user: "text_adventure_game",
	password: "D8T3tcHE~td03;[)jftvi <+3",
	database: "text_adventure_games"
});

sql.connect(err => {
    if (err) throw err;
    sql.query(`
        SET FOREIGN_KEY_CHECKS = 0;

        CREATE TABLE IF NOT EXISTS games (
            name varchar(255) NOT NULL,
            ID int unsigned NOT NULL AUTO_INCREMENT,
            start int unsigned,
            PRIMARY KEY (ID),
            UNIQUE KEY name (name),
            FOREIGN KEY (start) REFERENCES locations (ID) ON DELETE SET NULL);

        CREATE TABLE IF NOT EXISTS locations (
            ID int unsigned NOT NULL AUTO_INCREMENT,
            description varchar(255) DEFAULT NULL,
            game int unsigned NOT NULL,
            name varchar(255) NOT NULL,
            PRIMARY KEY (ID),
            FOREIGN KEY (game) REFERENCES games (ID) ON DELETE CASCADE);

        CREATE TABLE IF NOT EXISTS paths (
            ID int unsigned NOT NULL AUTO_INCREMENT,
            start int unsigned NOT NULL,
            end int unsigned NOT NULL,
            game int unsigned NOT NULL,
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
            PRIMARY KEY (ID),
            FOREIGN KEY (obj1) REFERENCES objects (ID) ON DELETE CASCADE,
            FOREIGN KEY (obj2) REFERENCES objects (ID) ON DELETE CASCADE);
        
        CREATE TABLE IF NOT EXISTS grab (
            ID int unsigned NOT NULL AUTO_INCREMENT,
            obj int unsigned NOT NULL,
            success boolean NOT NULL DEFAULT true,
            PRIMARY KEY (ID),
            FOREIGN KEY (obj) REFERENCES objects (ID) ON DELETE CASCADE);
        
        CREATE TABLE IF NOT EXISTS constraints (
            ID int unsigned NOT NULL AUTO_INCREMENT,
            obj int unsigned NOT NULL,
            state int unsigned NOT NULL,
            PRIMARY KEY (ID),
            FOREIGN KEY (obj) REFERENCES objects (ID) ON DELETE CASCADE);
        
        CREATE TABLE IF NOT EXISTS effects (
            ID int unsigned NOT NULL AUTO_INCREMENT,
            obj int unsigned,
            state int unsigned,
            text varchar(255),
            PRIMARY KEY (ID),
            FOREIGN KEY (obj) REFERENCES objects (ID) ON DELETE SET NULL);

        CREATE TABLE IF NOT EXISTS grab_to_constraint (
            grab int unsigned NOT NULL,
            constraint_ int unsigned NOT NULL,
            FOREIGN KEY (grab) REFERENCES grab (ID) ON DELETE CASCADE,
            FOREIGN KEY (constraint_) REFERENCES constraints (ID) ON DELETE CASCADE);
    
        CREATE TABLE IF NOT EXISTS grab_to_effect (
            grab int unsigned NOT NULL,
            effect int unsigned NOT NULL,
            FOREIGN KEY (grab) REFERENCES grab(ID) ON DELETE CASCADE,
            FOREIGN KEY (effect) REFERENCES constraints(ID) ON DELETE CASCADE);    
    
        CREATE TABLE IF NOT EXISTS path_to_constraint (
            path int unsigned NOT NULL,
            constraint_ int unsigned NOT NULL,
            FOREIGN KEY (path) REFERENCES paths(ID) ON DELETE CASCADE,
            FOREIGN KEY (constraint_) REFERENCES constraints(ID) ON DELETE CASCADE);
    
        CREATE TABLE IF NOT EXISTS path_to_effect (
            path int unsigned NOT NULL,
            effect int unsigned NOT NULL,
            FOREIGN KEY (path) REFERENCES paths(ID) ON DELETE CASCADE,
            FOREIGN KEY (effect) REFERENCES effects(ID) ON DELETE CASCADE);
    
        CREATE TABLE IF NOT EXISTS action_to_constraint (
            action int unsigned NOT NULL,
            constraint_ int unsigned NOT NULL,
            FOREIGN KEY (action) REFERENCES actions (ID) ON DELETE CASCADE,
            FOREIGN KEY (constraint_) REFERENCES constraints (ID) ON DELETE CASCADE);
    
        CREATE TABLE IF NOT EXISTS action_to_effect (
            action int unsigned NOT NULL,
            effect int unsigned NOT NULL,
            FOREIGN KEY (action) REFERENCES actions (ID) ON DELETE CASCADE,
            FOREIGN KEY (effect) REFERENCES effects (ID) ON DELETE CASCADE);

        SET FOREIGN_KEY_CHECKS = 1;
    `, err => {
        if (err) throw err;
        console.log('successfully created tables');
        process.exit(0);
    });
});