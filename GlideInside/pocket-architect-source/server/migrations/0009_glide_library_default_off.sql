-- Builder material shows only that builder's own designs: the Glide Inside sample library is hidden from client logins
-- unless the builder turns on "Show Glide Inside sample designs to clients" (orgs.show_glide_to_clients).
UPDATE orgs SET show_glide_to_clients = 0;
