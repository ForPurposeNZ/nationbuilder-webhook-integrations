# nationbuilder-webhook-integrations

A web service to provide webhook endpoints for Raisely and Action Network to write data to Nationbuilder.

## Route Overview

There are four routes that recieve webhook calls:

### /donations-raisely-payment

Creates a donation entry from a payment webhook call originating from Raisly (3rd party payment provider)
Route file: donations-raisely-payment.js

### /memberships-raisely-payment

Updates or extends persons membership from a webhook call originating from Raisly (3rd party payment provider)
Route file: memberships-raisely-payment.js

### /raisely-membership-subscription

Handles Raisely membership subscription changes. Currently this route is only used to cancel memberships.
Route file: - memberships-raisely-subscription.js

### /person-create-action-network

Creates a person from Action Network payload. Currently signature and submission payloads are supported.
Route file: - people-create-action-network.js

Note - the Action Network route is currently deployed on a seperate Heroku instance.

### Environment Settings 

The web service uses environment variables to configure the routes and the connection to Nationbuilder API. 

- For local developement, copy the `.env-sample` file and create a `.env` file. 
- For Heroku deployment, environment settings can be configured in the web panel.

#### List of environment variables

*Nationbuilder Variables*

```
NATIONBUILDER_SLUG=Main Nationbuilder Organisation Slug, i.e: XXX.nationbuilder.com
NATIONBUILDER_SITE_SLUG=The Slug of the Web Site (nations can have multiple sites)
NATIONBUILDER_API_TOKEN=Nationbuilder Developer API Token
PORT=Port the Web Service Runs On, defaults to 3000
CORS_WEBSITE_WHITELIST=This setting should be set on production site for security. 
If this setting does not exist or is blank, it will allow any site to connect to the web service. 
If set, it should contain a comma seperated list of the whitelisted sites that are allowed to connect to the webservice. 
```

*Route Variables*

Each API route needs a token set to activate. The token can be any string, it just has to exist. 

```
TOKEN_DONATIONS_RAISELY_PAYMENT
TOKEN_MEMBERSHIP_PAYMENT
TOKEN_MEMBERSHIP_SUBSCRIPTION
TOKEN_PERSON_CREATE_ACTION_NETWORK
```

Raisely calls should have a shared secret set and the relevant variable set to the same value.

```
DONATIONS_RAISELY_PAYMENT_SHARED_SECRET
TOKEN_MEMBERSHIP_PAYMENT_SHARED_SECRET
TOKEN_MEMBERSHIP_SUBSCRIPTION_SHARED_SECRET
```

For the membership webhooks the default membership name should be set.

```
TOKEN_MEMBERSHIP_PAYMENT_MEMBERSHIP_NAME
TOKEN_MEMBERSHIP_SUBSCRIPTION_MEMBERSHIP_NAME
```

Note there is some hard coded values in the routes that change the membership name depending on the campaign.
We spent some time trying to pass the membership name across from Raisely in the webhook, but found 
Raisely did not support doing this in the way the campagins had been set up.




