var test_game = new Map();
test_game.set("prison cell",
	{decription: "You wake up in a small prison cell with no windows. \
	The door is locked, but you see a small key hanging just outside your reach. \
	The room is empty execpt for a long stick lying on the floor.",
	objects: ["stick", "key", "door"],
	adjacent_locations: []});
var all_objects = [
	{name: "stick",
	pick_up: function() {inventory.push("stick"); return "You have a stick!";},
	actions: [["key", function() {
		find("key").pick_up = function() {inventory.push("key"); return "You have a key!";};
		find(stick).actions.remove_action("key");
		return "The stick knocks down the key, putting it within reach."}]]},
	
	{name: "key", pick_up: function() {return "You can't reach it."},
	actions: [["door", function() {find("door").description = "The door is now open";
		/*add adjacent location*/return "You put the key in the lock, and the door opens.";}
	];