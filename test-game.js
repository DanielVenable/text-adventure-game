var current_room = "prison cell",
game = [{name: "prison cell",
	description: `You wake up in a small prison cell with no windows.
	The door is locked, but you see a small key hanging just outside your reach.
	The room is empty execpt for a long stick lying on the floor.`,
	objects: ["stick", "key", "door"],
	adjacent_locations: []}],
objects = [
	{name: "stick", pick_up: function() {inventory.push("stick"); return "You have a stick!";},
	actions: [{name:"key", func: function() {
		find(objects, "key").pick_up = function() {
			inventory.push("key"); return "You have a key!";};
			remove_action(find(objects, "stick").actions, "key");
			return "The stick knocks down the key, putting it within reach."}}],
		description: "It is a long wooden stick."},
	
	{name: "key", pick_up: () => "You can't reach it.", actions: [{
		name:"door", func: function() {
			find(objects, "door").description = "The door is now open";
			find(game, "prison cell").adjacent_locations.push("forest");
			return "You put the key in the lock, and the door opens.";}}],
		description: "It is a small, brass key."},
		
	{name: "door", pick_up: function() {return "You can't pick up a door."}, actions: [],
		description: "The large, metal door is locked shut, blocking your way out."}];