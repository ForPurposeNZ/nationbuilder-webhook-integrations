// Common API end points to connect to Nationbuilder
// Created by For Purpose

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require("body-parser");

// Load env settings

const PORT = process.env.PORT || 8080;
const CORS_WEBSITE_WHITELIST = process.env.CORS_WEBSITE_WHITELIST || "";
const ATTACHMENT_SIZE_LIMIT = process.env.ATTACHMENT_SIZE_LIMIT || "50mb";

// Require Routes (see below for more detailed desciptions)

const membershipsRaiselyPaymentRoute = require('./routes/memberships-raisely-payment');
const membershipsRaiselySubscriptionRoute = require('./routes/memberships-raisely-subscription');
const donationsRaiselyPaymentRoute = require('./routes/donations-raisely-payment');
const personCreateActionNetworkRoute = require('./routes/people-create-action-network');

const app = express();

// CORS White List Security

if (!CORS_WEBSITE_WHITELIST) {
  // if no whitelist set, no security, useful for development
  app.use(cors());
} else {
  // set CORS whitelist security
  var corsWebsiteWhitelistArray = CORS_WEBSITE_WHITELIST.split(',');
  // TODO - trim values
  var corsOptions = {
    origin: function (origin, callback) {
      if (corsWebsiteWhitelistArray.indexOf(origin) !== -1) {
        console.log("CORS SUCCESS: request from: " + origin);
        callback(null, true)
      } else {
        console.log("CORS FAIL: request from: " + origin);
        callback(new Error('Not allowed by CORS'))
      }
    }
  }
  app.use(cors(corsOptions));
}

app.use(bodyParser.json({ limit: ATTACHMENT_SIZE_LIMIT }));

// Routes

// Check service is running
app.get('/', function (req, res) {
  res.send('Service Running');
});

// Raisely Routes (Raisely is a 3rd party payment provider)

// Update membership from Raisely payment 
app.post('/memberships-raisely-payment', membershipsRaiselyPaymentRoute);
app.post('/membership-payment', membershipsRaiselyPaymentRoute); // alternative route for backwards compatibility

// Update membership from Raisely subscription change (3rd party payment provider)
app.post('/raisely-membership-subscription', membershipsRaiselySubscriptionRoute);

// Add a donation for a Raisely payment payload (3rd party payment provider)
app.post('/donations-raisely-payment', donationsRaiselyPaymentRoute);

// Action Network Routes (Action Network is a 3rd party service providing Nationbuilder like functionality)

// Create/Update a person from an Action Network payload (3rd party service)
app.post('/person-create-action-network', personCreateActionNetworkRoute);

// Run Server

(async () => {

  // Run any initialisation tasks
  // ...

  // Listen on port
  app.listen(PORT, function () {
    console.log('App listening on port ' + PORT);
  });  
})();
