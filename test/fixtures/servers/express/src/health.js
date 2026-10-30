const r = require("express").Router();
r.get("/live", (_req, res) => res.end());
module.exports = r;
