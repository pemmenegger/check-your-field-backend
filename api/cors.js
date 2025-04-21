module.exports = function () {
  return function (req, res, next) {
    var requestOrigin = req.get("origin") || req.headers.origin || "";

    var allowedOrigin = "https://checkyourfield.org";
    var whitelist = ["http://localhost:8080", "https://checkyourfield.org", "https://www.checkyourfield.org"];

    for (var i = 0; i < whitelist.length; i++) {
      if (requestOrigin && requestOrigin.startsWith(whitelist[i])) {
        allowedOrigin = whitelist[i];
        break;
      }
    }

    res.header("Access-Control-Allow-Origin", allowedOrigin);
    res.header("Access-Control-Allow-Headers", "X-Requested-With");
    next();
  };
};
