/**
 * Routes for the RESTful API
 */
// @todo: check the http://expressjs.com/api.html#app.param to regexp the route without validator
var router = require('express').Router(),
    Model = require("../model"),
    perl = require("../lib/perl");

/**
 * Configure the router object to serve the API for a model class.
 * @param router The express.Router object
 * @param api_path The URI sub-path to the API, e.g. "/vpn"
 * @param model One of the model.Foo classes
 */
function configure_API_subdir(router, api_path, model) {
    /* Serve e.g. /vpn */
    router.get(api_path, function(req, res, next) {
        model.all(function (all, error) {
            if (error) {
                return next(error);
            }
            //console.log("Adding X-Total-Count to header: " + all.length);
            res.header('X-Total-Count', all.length); // add the array.length value to header for pagination purpose
            // first sort the whole list
            all = Model.sort(all, req.query._sortField, req.query._sortDir);
            // then return sliced array for pagination
            res.json(Model.paginate(all, req.query._page, req.query._perPage)) ;
        });
    });

    /* Serve e.g. /vpn/foo */
    router.get(api_path + '/*', function(req, res, next) {
        var urlparts = req.url.split("/");
        var stem = urlparts.pop();
        if (model.primaryKey.validate) {
            model.primaryKey.validate(stem);
        }
        /* There has to be a better way than an exhaustive search here. */
        model.all(function(all, error) {
            if (error) {
                return next(error);
            }
            var done;
            all.forEach(function (value, index) {
                if (! done && value[model.primaryKey.name] == stem) {
                    res.json(value);
                    done = true;
                }
            });
            if (! done) {
                next({message: "Unknown resource " + req.url});
            }
        });
    });

    function apiWriteHandler(method_name) {
        return function(req, res, next) {
            perl.talkJSONToPerl(
                "use " + model.perlControllerPackage + "; "
                + model.perlControllerPackage + "->" + method_name + "_from_stdin;",
                req.body,
                function (result, err) {
                    if (err && typeof err === "object") { // Not Exception, not a String
                        // Orderly failure - TODO: is there a way to have
                        // ng-admin pretty-print an error message?
                        // (as-is, it shows an ugly red 'Oops')
                        res.status(500);
                        res.json(err);
                    } else if (err) {
                        // Disorderly failure
                        return next(err);
                    } else {
                        res.json(result);
                    }
                }
            )
        }
    }

    if (model.perlControllerPackage) {
        router.post(api_path, apiWriteHandler("post"));
        router.put(api_path + "/:id", function (req, res, next) {
            req.body[model.primaryKey] = req.id;
            apiWriteHandler("put")(req, res, next);
        });
        router.delete(api_path + "/:id", function (req, res, next) {
            req.body[model.primaryKey] = req.id;
            apiWriteHandler("delete")(req, res, next);
        });
    }
}

configure_API_subdir(router, "/vpn", Model.VPN);
configure_API_subdir(router, "/vnc", Model.VNCTarget);
configure_API_subdir(router, "/bbx", Model.BBox);
configure_API_subdir(router, "/user", Model.User);
configure_API_subdir(router, "/group", Model.Group);
configure_API_subdir(router, "/status", Model.Status);

module.exports = router;
