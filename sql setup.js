const mysql = require('mysql');

var sql = mysql.createConnection({
	host: "localhost",
	user: "text_adventure_game",
	password: "D8T3tcHE~td03;[)jftvi <+3",
	database: "text_adventure_games"
});

sql.connect(function(err) {
	if (err) throw err;
    sql.query(`
        create table if not exists grab_to_constraint (
            grab int unsigned not null,
            constraint_ int unsigned not null,
            foreign key (grab) references grab(ID),
            foreign key (constraint_) references constraints(ID));
    `, (err) => {
        if (err) throw err;
    });
    sql.query(`
        create table if not exists grab_to_constraint (
            grab int unsigned not null,
            constraint_ int unsigned not null,
            foreign key (grab) references grab(ID),
            foreign key (constraint_) references constraints(ID));
    `, (err) => {
        if (err) throw err;

    });
    sql.query(`create table if not exists grab_to_effect (
        grab int unsigned not null,
        effect int unsigned not null,
        foreign key (grab) references grab(ID),
        foreign key (effect) references effects(ID));
    `, (err) => {
        if (err) throw err
    });
});