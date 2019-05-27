var current_location = "prison cell",
game = [{name: "prison cell", 
	description: `You are in a small prison cell with no windows.<br/>
	The door is locked, but you see a small key hanging just outside your reach.<br/>
	The room is empty execpt for a long stick lying on the floor.`,
	objects: ["stick", "key", "door"], adjacent_locations: []},
	{name: "hallway", description: `The hallway contains lots of empty prison cells.<br/>
	At the end of the hall there is a portal, but it is not working.`, objects: ["portal", "wire"],
	adjacent_locations: ["prison cell"]}
],
objects = [
	{name: "stick", pick_up: () => actually_pick_up("stick"),
	actions: [{name: "key", func: function() {
		find(objects, "key").pick_up = () => actually_pick_up("key");
		remove_action(find(objects, "stick").actions, "key");
		return "The stick knocks down the key, putting it within reach."}},
	{name: "wire", func: function() {
		find(objects, "portal").actions = [
			{name: "", func: () => "You go through the portal and escape the prison. You win!"}];
		inventory.splice(inventory.indexOf("key"), 1);
		find(objects, "wire").decription = "The wire is fixed now.";
		return `The key connects the wires and the portal turns on.`;
	}}],
	description: "It is a long wooden stick."},
	{name: "key", pick_up: () => "You can't reach it.", actions: [{
		name:"door", func: function() {
			find(objects, "door").description = "The door is now open.";
			find(game, "prison cell").adjacent_locations.push("hallway");
			return "You put the key in the lock, and the door opens out to a hallway.";}}],
		description: "It is a small, brass key."},
	{name: "door", pick_up: () => "You can't pick up a door.", actions: [],
		description: "The large, metal door is locked shut, blocking your way out."},
	{name: "portal", pick_up: () => "It is too heavy.", description: `It is a large, circular, portal.<br/>
	You see a broken wire near the base of the portal, which is probably why it doesn't work right now.`,},
	{name: "wire", pick_up: () => "The wire is firmly in place", decription: `The wire is broken near
	the base of the portal.<br/>It is a small gap, but it won't reach far enough to connect.`,}];