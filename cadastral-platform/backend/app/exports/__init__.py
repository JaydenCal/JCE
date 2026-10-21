"""Stage 11 exports of the site model: GLB of the whole site, DXF of the site design on the JCS layer codes, and CSV or JSON schedules.

Every export is built on the server from the stored scene bundle and the stored site design of the project, and carries the same status labels as the viewer
(terrain status, UNVERIFIED services, pending AI proposals). Nothing is invented: a value that is not in the data is written DATA NOT AVAILABLE.
"""
