CREATE TABLE IF NOT EXISTS users (
    id SERIAL,
    username varchar(255) NOT NULL UNIQUE,
    hash char(64) NOT NULL,
    PRIMARY KEY (id));

CREATE TABLE IF NOT EXISTS games (
    id SERIAL,
    name varchar(255) NOT NULL,
    text varchar(65535) NOT NULL,
    start int,
    public bool DEFAULT false,
    PRIMARY KEY (id));

CREATE TABLE IF NOT EXISTS user_to_game (
    user_ int NOT NULL,
    game int NOT NULL,
    permission int NOT NULL DEFAULT 0,
	FOREIGN KEY (user_) REFERENCES users (id) ON DELETE CASCADE,
	FOREIGN KEY (game) REFERENCES games (id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS locations (
    id SERIAL,
    game int NOT NULL,
    name varchar(255) NOT NULL,
    PRIMARY KEY (id),
	FOREIGN KEY (game) REFERENCES games (id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS paths (
    id SERIAL,
    start int NOT NULL,
    end_ int,
    text varchar(255) NOT NULL DEFAULT '',
    win bool,
    PRIMARY KEY (id),
    FOREIGN KEY (start) REFERENCES locations (id) ON DELETE CASCADE,
    FOREIGN KEY (end_) REFERENCES locations (id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS objects (
    id SERIAL,
    name varchar(255),
    location int,
    game int NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (game) REFERENCES games (id) ON DELETE CASCADE,
    FOREIGN KEY (location) REFERENCES locations (id) ON DELETE SET NULL);

CREATE TABLE IF NOT EXISTS actions (
    id SERIAL,
    obj1 int NOT NULL,
    obj2 int,
    text varchar(255) NOT NULL DEFAULT '',
    win bool,
    PRIMARY KEY (id),
    FOREIGN KEY (obj1) REFERENCES objects (id) ON DELETE CASCADE,
    FOREIGN KEY (obj2) REFERENCES objects (id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS grab (
    id SERIAL,
    obj int NOT NULL,
    success boolean NOT NULL DEFAULT true,
    text varchar(255) NOT NULL DEFAULT '',
    win bool,
    PRIMARY KEY (id),
    FOREIGN KEY (obj) REFERENCES objects (id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS constraint_and_effect (
    id SERIAL,
    game int NOT NULL,
    obj int,
    loc int,
    name varchar(255), -- null means default
    PRIMARY KEY (id),
    FOREIGN KEY (game) REFERENCES games (id) ON DELETE CASCADE,
    FOREIGN KEY (obj) REFERENCES objects (id) ON DELETE CASCADE,
    FOREIGN KEY (loc) REFERENCES locations (id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS grab_to_constraint (
    grab int NOT NULL,
    constraint_ int NOT NULL,
    FOREIGN KEY (grab) REFERENCES grab (id) ON DELETE CASCADE,
    FOREIGN KEY (constraint_) REFERENCES constraint_and_effect (id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS grab_to_effect (
    grab int NOT NULL,
    effect int NOT NULL,
    FOREIGN KEY (grab) REFERENCES grab(id) ON DELETE CASCADE,
    FOREIGN KEY (effect) REFERENCES constraint_and_effect (id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS path_to_constraint (
    path int NOT NULL,
    constraint_ int NOT NULL,
    FOREIGN KEY (path) REFERENCES paths(id) ON DELETE CASCADE,
    FOREIGN KEY (constraint_) REFERENCES constraint_and_effect (id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS path_to_effect (
    path int NOT NULL,
    effect int NOT NULL,
    FOREIGN KEY (path) REFERENCES paths(id) ON DELETE CASCADE,
    FOREIGN KEY (effect) REFERENCES constraint_and_effect (id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS action_to_constraint (
    action int NOT NULL,
    constraint_ int NOT NULL,
    FOREIGN KEY (action) REFERENCES actions (id) ON DELETE CASCADE,
    FOREIGN KEY (constraint_) REFERENCES constraint_and_effect (id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS action_to_effect (
    action int NOT NULL,
    effect int NOT NULL,
    FOREIGN KEY (action) REFERENCES actions (id) ON DELETE CASCADE,
    FOREIGN KEY (effect) REFERENCES constraint_and_effect (id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS location_constraint_and_effect (
    id SERIAL,
    obj int NOT NULL,
    location int,
    PRIMARY KEY (id),
    FOREIGN KEY (obj) REFERENCES objects (id) ON DELETE CASCADE,
    FOREIGN KEY (location) REFERENCES locations (id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS grab_to_location_constraint (
    grab int NOT NULL,
    constraint_ int NOT NULL,
    FOREIGN KEY (grab) REFERENCES grab (id) ON DELETE CASCADE,
    FOREIGN KEY (constraint_) REFERENCES location_constraint_and_effect (id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS grab_to_location_effect (
    grab int NOT NULL,
    effect int NOT NULL,
    FOREIGN KEY (grab) REFERENCES grab(id) ON DELETE CASCADE,
    FOREIGN KEY (effect) REFERENCES location_constraint_and_effect (id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS path_to_location_constraint (
    path int NOT NULL,
    constraint_ int NOT NULL,
    FOREIGN KEY (path) REFERENCES paths(id) ON DELETE CASCADE,
    FOREIGN KEY (constraint_) REFERENCES location_constraint_and_effect (id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS path_to_location_effect (
    path int NOT NULL,
    effect int NOT NULL,
    FOREIGN KEY (path) REFERENCES paths(id) ON DELETE CASCADE,
    FOREIGN KEY (effect) REFERENCES location_constraint_and_effect (id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS action_to_location_constraint (
    action int NOT NULL,
    constraint_ int NOT NULL,
    FOREIGN KEY (action) REFERENCES actions (id) ON DELETE CASCADE,
    FOREIGN KEY (constraint_) REFERENCES location_constraint_and_effect (id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS action_to_location_effect (
    action int NOT NULL,
    effect int NOT NULL,
    FOREIGN KEY (action) REFERENCES actions (id) ON DELETE CASCADE,
    FOREIGN KEY (effect) REFERENCES location_constraint_and_effect (id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS grab_to_inventory_constraint (
    grab int NOT NULL,
    obj int NOT NULL,
    have_it bool NOT NULL,
    FOREIGN KEY (grab) REFERENCES grab (id) ON DELETE CASCADE,
    FOREIGN KEY (obj) REFERENCES objects (id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS grab_to_inventory_effect (
    grab int NOT NULL,
    obj int NOT NULL,
    FOREIGN KEY (grab) REFERENCES grab (id) ON DELETE CASCADE,
    FOREIGN KEY (obj) REFERENCES objects (id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS path_to_inventory_constraint (
    path int NOT NULL,
    obj int NOT NULL,
    have_it bool NOT NULL,
    FOREIGN KEY (path) REFERENCES paths(id) ON DELETE CASCADE,
    FOREIGN KEY (obj) REFERENCES objects (id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS path_to_inventory_effect (
    path int NOT NULL,
    obj int NOT NULL,
    FOREIGN KEY (path) REFERENCES paths(id) ON DELETE CASCADE,
    FOREIGN KEY (obj) REFERENCES objects (id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS action_to_inventory_constraint (
    action int NOT NULL,
    obj int NOT NULL,
    have_it bool NOT NULL,
    FOREIGN KEY (action) REFERENCES actions (id) ON DELETE CASCADE,
    FOREIGN KEY (obj) REFERENCES objects (id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS action_to_inventory_effect (
    action int NOT NULL,
    obj int NOT NULL,
    FOREIGN KEY (action) REFERENCES actions (id) ON DELETE CASCADE,
    FOREIGN KEY (obj) REFERENCES objects (id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS descriptions (
    id SERIAL,
    location int NOT NULL,
    num int NOT NULL,
    text varchar(255) NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (location) REFERENCES locations (id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS description_to_location_constraint (
    description int NOT NULL,
    constraint_ int NOT NULL,
    FOREIGN KEY (description) REFERENCES descriptions (id) ON DELETE CASCADE,
    FOREIGN KEY (constraint_) REFERENCES location_constraint_and_effect (id));

CREATE TABLE IF NOT EXISTS description_to_inventory_constraint (
    description int NOT NULL,
    obj int NOT NULL,
    have_it bool NOT NULL,
    FOREIGN KEY (description) REFERENCES descriptions (id) ON DELETE CASCADE,
    FOREIGN KEY (obj) REFERENCES objects (id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS description_to_constraint (
    description int NOT NULL,
    constraint_ int NOT NULL,
    FOREIGN KEY (description) REFERENCES descriptions (id) ON DELETE CASCADE,
    FOREIGN KEY (constraint_) REFERENCES constraint_and_effect (id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS names (
    name varchar(255) NOT NULL,
    obj int NOT NULL,
    FOREIGN KEY (obj) REFERENCES objects (id) ON DELETE CASCADE,
    UNIQUE (name, obj));

CREATE TABLE IF NOT EXISTS path_names (
    name varchar(255) NOT NULL,
    path int NOT NULL,
    FOREIGN KEY (path) REFERENCES paths (id) ON DELETE CASCADE,
    UNIQUE (name, path));

ALTER TABLE games
    ADD CONSTRAINT constraint_fk
    FOREIGN KEY (start)
    REFERENCES locations(id)
    ON DELETE CASCADE;