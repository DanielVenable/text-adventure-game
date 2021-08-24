# Text-adventure-game

A program that lets you create and play text adventure games.

## Setup

Click [here](https://text-adventure-game-creator.herokuapp.com) to play the game.

### Running the App Locally

To run the app locally, follow these steps:

1. Create a postgres database and run the commands in [sql-setup.sql](sql-setup.sql) on it.
2. Add a .env file with the following enviroment variables:
    * DATABASE_URL: the url of the postgres database
    * PORT: the port number to run the server on
    * SECRET_KEY: a random string
3. Run "npm start" in a terminal.
4. In a web browser, go to localhost:*port* where *port* is the port the server is running on.

## Playing a Game

To start a game, click on the game you want to start.

It will give you a discription of your surroundings and you will type commands to tell it what you are doing.

There are three commands:
* (use ... on ...) uses an item in your inventory on an object in the room.
* (go to ...) goes to an adjacent location.
* (pick up ...) moves an item in the room to your inventory.

Play the game and try to win.

Have fun!

## Making a Game

You must be signed in to make a game. To do that, click the "Sign in/Sign up" button.

Click the "make your own game" button to make your own game.
Or you can mouse over the "edit a game button" to edit an already made game.

Click the question mark in a circle button in the edit page for help on how to edit a game.

## Publishing a Game

You can only publish a game if you control the database.

If you do and you want to publish a game,
type "UPDATE games SET public = TRUE WHERE id = __", replacing the __ with the id of the game, into the database.

(The id is the number at the end of the url when you are editing the game.)