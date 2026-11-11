// Plain, short, family friendly English words for easy to say temporary passwords (docs/PORTAL_API.md 5).
// Keep every entry lowercase letters only, 3 to 7 letters, no duplicates. tests/portal.test.mjs checks the list.

export const WORDS = `
river maple cedar olive lemon peach mango berry apple grape melon plum cherry honey sugar
salt pepper basil mint sage thyme ginger cocoa bread toast cream butter cheese bacon pasta
rice bean corn pea carrot onion potato tomato lime fig date nut almond walnut pecan oat
wheat barley flour dough cake pie jam jelly candy syrup tea coffee milk juice soup stew
salad steak koala emu wombat dingo roo gecko parrot magpie finch robin wren eagle hawk owl
duck swan goose crane heron stork fox wolf bear deer moose otter seal whale shark dolphin
crab fish trout salmon tuna eel frog toad snail bee ant moth beetle spider cricket horse
pony zebra camel llama sheep lamb goat cow bull pig hen rooster chick rabbit hare mouse
badger beaver panda tiger lion cheetah monkey gorilla koi turtle lizard sun moon star cloud
rain snow wind storm frost mist dew fog sky sea lake pond creek brook stream beach sand dune
cliff rock stone hill ridge peak valley field meadow forest grove wood leaf branch twig root
seed bloom petal flower daisy rose tulip lily iris fern moss reed vine bush shrub palm pine
oak elm ash birch willow gum wattle waratah red blue green gold silver amber coral teal navy
ruby jade pearl ivory ochre tan grey black white pink purple orange yellow brown cyan lilac
crimson scarlet copper bronze lamp clock chair table desk door gate fence wall roof floor
brick tile paint brush hammer nail screw saw drill ladder bucket rope chain anchor boat sail
oar kite ball drum bell flute harp piano guitar book pen pencil paper map key lock box bag
basket jar cup bowl plate spoon fork knife pan pot kettle toaster oven fridge sofa bed rug
mat shelf frame mirror window curtain pillow blanket happy sunny quiet calm brave bright
swift gentle kind warm cool fresh clear soft smooth sharp round tall small big tiny grand
lucky merry jolly proud steady fast slow early late young old new cosy neat tidy shiny clean
dry wet light dark rich plain wild free true wise keen north south east west down left right
front back over under noon dawn dusk day night week month year spring summer autumn winter
road path track trail lane street bridge tunnel station train tram bus truck van car bike
ship plane rocket tower castle cabin barn shed hut tent camp farm garden park market shop
cafe school race jump run walk swim climb dance sing play game goal team coach score point
win tie prize medal trophy one two three four five six seven eight nine ten dozen half azure
beige denim fawn hazel indigo khaki mauve mocha rust slate tawny umber arrow badge banner
beacon candle compass crown feather flag globe harbor island jewel lantern ocean planet
pocket pillar ribbon shield signal summit sunset thunder trumpet voyage whistle pebble
magnet hammock sandal jumper scarf boots gloves hat coat shirt sock belt ring button zip
needle thread wool cotton silk linen fleece mitten sweater apron towel soap comb razor
`.split(/\s+/).filter(Boolean);
