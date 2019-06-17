function new_game() {
	$("#buttons").empty();
	output(`You are taking a walk in the forest when a large man grabs you from behind.<br/>
		You hear a voice from behind you say, "That's the one we're after, throw them in the dungeon!"</br>
		Suddenly, a trap door opens beneath you and you fall into the dungeon.`);
	current_location = "prison cell";
	game = [
		{name: "prison cell",
			description: `You are in a small prison cell with no windows.<br/>
			The door is locked, but you see a small key hanging just outside your reach.<br/>
			The room is empty execpt for a long stick lying on the floor.`,
		objects: ["stick", "key", "door"], adjacent_locations: []},
		{name: "hallway",
			description: `The hallway contains lots of empty prison cells.<br/>
				At the end of the hall there is a portal, but it is not working.`, objects: ["portal", "wire"],
			adjacent_locations: ["prison cell"]}
	];
	objects = [
		{name: "stick", pick_up: [true, "stick"],
			actions: [{name: "key", func: ["The stick knocks down the key, putting it within reach.",
				{is_obj: true, name: "key", modify: "pick up", value: [true, "key"]},
				{is_obj: true, name: "stick", modify: "remove action", action_name: "key"}]}],
			description: "It is a long wooden stick."},
		
		{name: "key", pick_up: ["You can't reach it."], actions: [
			{name: "door", func: ["You put the key in the lock, and the door opens out to a hallway.",
				{is_obj: true, name: "door", modify: "description", value: "The door is now open."},
				{is_obj: false, name: "prison cell", modify: "add location", value: "hallway"},
				{is_obj: false, name: "prison cell", modify: "description", value: "You are in a prison cell with the door wide open."}]},
			{name: "wire", func: ["The key connects the wires and the portal turns on.",
				{is_obj: true, name: "portal", modify: "actions",
					value: {name: "", func: ["You go through the portal and escape the prison. You win!"]}},
				{is_obj: true, name: "wire", modify: "description", value: "The wire is fixed now."},
				{modify: "inventory", name: "key"},
				{is_obj: true, name: "portal", modify: "description", value: "It is a large, circular portal."},
				{is_obj: false, name: "hallway", modify: "description",
					value: "The hallway contains lots of empty prison cells.<br/>At the end of the hall you see a portal."}
			]}],
			description: "It is a small, metal key."},
		{name: "door", pick_up: ["You can't pick up a door."], actions: [],
			description: "The large, metal door is locked shut, blocking your way out."},
		{name: "portal", pick_up: ["It is too heavy."], actions: [], description: `It is a large, circular, portal.<br/>
			You see a broken wire near the base of the portal, which is probably why it doesn't work right now.`},
		{name: "wire", pick_up: ["The wire is firmly in place"], actions: [], description: `The wire is broken near
			the base of the portal.<br/>It is a small gap, but it won't reach far enough to connect.`}
	];
	output(find(game, current_location).description);
}