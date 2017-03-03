var express = require('express');
var cors = require('cors');
var request = require('request');
var bodyParser = require('body-parser');
var fs = require('fs');
var path = require('path');
var morgan = require('morgan');
var querystring = require('querystring');

var session = require('express-session');

var serverInfos = [ {
    "server" : "http://[STAGING_AGS_HOST]/arcgis",
    "tokenServiceUrl" : "http://[STAGING_AGS_HOST]/arcgis/tokens/",
    "adminTokenServiceUrl" : "http://[STAGING_AGS_HOST]/arcgis/admin/generateToken",
    "shortLivedTokenValidity" : 60,
    "currentVersion" : 10.31,
    "hasServer" : true,
    "tokenUrl" : "http://[STAGING_AGS_HOST]/arcgis/tokens/generateToken"
}, {
    "server" : "https://[PRODUCTION_WEBADAPTOR_HOST]/arcgis",
    "tokenServiceUrl" : "https://[PRODUCTION_PORTAL_HOST]/portal/sharing/generateToken",
    "adminTokenServiceUrl" : "https://[PRODUCTION_WEBADAPTOR_HOST]/arcgis/admin/generateToken",
    "owningSystemUrl" : "https://[PRODUCTION_PORTAL_HOST]/portal",
    "currentVersion" : 10.31,
    "hasServer" : true
}, {
    "server" : "https://[PRODUCTION_PORTAL_HOST]/portal",
    "tokenServiceUrl" : "https://[PRODUCTION_PORTAL_HOST]/portal/sharing/generateToken",
    "hasPortal" : true,
    "webTierAuth" : false,
    "tokenUrl" : "https://[PRODUCTION_PORTAL_HOST]/portal/sharing/generateToken"
} ];

var app = express();  

// Configure log with morgan + log4js
var log4js = require('log4js');
log4js.configure('log4js-config.json', { reloadSecs: 300 });

var theAppLog = log4js.getLogger('app');
var theHTTPLog = morgan('combined', {
  stream: {
    write: function(str) { theAppLog.info(str.substring(0,str.lastIndexOf('\n'))); }
  }
});
//^ Configure log with morgan + log4js

// CORS configuration
var whitelist = ['http://localhost:8080', 'http://localhost', 'http://localhost:3000', 'http://10.110.115.205:8080', 'http://10.110.115.205'];
var corsOptions = {
  origin: function (origin, callback) {
      //console.log(origin);
    var originIsWhitelisted = whitelist.indexOf(origin) !== -1
    callback(originIsWhitelisted ? null : 'Bad Request', originIsWhitelisted)
  },
  credentials: true,
  optionsSuccessStatus: 200
}
//^ CORS configuration

app.use(theHTTPLog);

app.disable('x-powered-by');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
    extended : false
}));

app.use(session({
    key: 'TheKey',
    secret: '[THE SECRET]',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: false, maxAge: 3600000 },
    name: 'AGSAuthSession'
}));

app.use(cors(corsOptions));

app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    
    var strErr = JSON.stringify(err);
    theAppLog.error(strErr);
    theAppLog.error(err.message);
    
    res.send(err);
});

app.post('/generateToken', function(req, res, next) {
    //console.log(req.headers.referer);
    
    //Kind of Keycloak specific
    var stringToFind = 'redirect_uri=';
    var indexRedirect = req.headers.referer.indexOf(stringToFind);
    //^ Kind of Keycloak specific
    
    var referer = decodeURIComponent(req.headers.referer.substring(indexRedirect + stringToFind.length));
    var doubleBarIndex = referer.indexOf('//');
    var barIndex = referer.indexOf('/', doubleBarIndex + 2);
    var refererHost = referer.substring(doubleBarIndex + 2, barIndex);
    /*console.log('REFERER FULL: ' + referer);
    console.log(doubleBarIndex);
    console.log(barIndex);
    console.log('REFERER WILL BE: ' + referer.substring(doubleBarIndex + 2, barIndex));*/
    
    var parameters = req.body;
    
    var form = {
        request: 'getToken',
        username: 'pmpa\\' + parameters.u,
        password: parameters.p,
        //expiration: 60
        expiration: 5040,
        referer: refererHost,
        client: 'referer'
    };
    
    var formProduction = {
        request: 'getToken',
        username: 'pmpa\\' + parameters.u,
        password: parameters.p,
        //expiration: 86400,
        expiration: 5040,
        referer: refererHost,
        f: 'json'
    };
    
    //REQUEST to development/staging server
    request({
        url: serverInfos[0].tokenUrl,
        method: 'POST',
        form: form
    }, function(error, response, body){
        if (error) {
            theAppLog.error(error);
            next(new Error(error));
        } else {
            var token;
            if (response.statusCode !== 200) {
                token = 'DUMMY';
            } else {
                token = body;
            }
            
            var session = req.session;
            session.generateTokenResponse = [];
            session.generateTokenResponse.push({
                userId: form.username,
                server: serverInfos[0].server,
                token: token,
                scope: "server"
            });
            
            console.log('Saved 1st token');
            
            //REQUEST to production server
            request({
                url: serverInfos[2].tokenUrl,
                method: 'POST',
                form: formProduction
            }, function(error, response, body){
                if (error) {
                    theAppLog.error(error);
                    
                    res.sendStatus(200);
                } else {
                    var token;
                    if (response.statusCode !== 200) {
                        token = 'DUMMY';
                    } else {
                        token = JSON.parse(body);
                    }
                    
                    var session = req.session;
                    session.generateTokenResponse.push({
                        userId: form.username,
                        server: serverInfos[2].server,
                        token: token.token ? token.token : token,
                        scope: "portal"
                    });
                    
                    console.log('Saved 2nd token');
                    
                    res.sendStatus(200);
                }
            });
        }
    });
});

app.get('/token', function(req, res) {
    var session = req.session;
    //console.log(session);
    var generateTokenResponse = (session || {}).generateTokenResponse;

    if (!generateTokenResponse) {
        res.sendStatus(403);
    } else {
        var response = {
            generateTokenResponse : generateTokenResponse,
            serverInfos : serverInfos
        };
        return res.json(response);
    }
});

app.listen(process.env.PORT || 3000, '0.0.0.0');