// Handles Raisely membership subscription changes.
// Raisely is a third party subscription provider - https://www.raisely.com/
// Currently this route is used to cancel memberships when an event is send from Raisely.
//
// Steps:
// 1. Recieves a webhook API call with predefined payload from Raisely
// 2. Looks up the user using their email address in the payload
// 3. Gets the users current membership details
// 4. If there is no membership it creates a new one
// 5. If a membership already exists it is extended

const joi = require("joi");
const peopleAPI = require('../nationbuilder-api/people-api');
const membershipsAPI = require('../nationbuilder-api/memberships-api');

// schema for Raisly webhook
const raislyPaymentsSchema = joi.object({  
  secret: joi.string().allow('').allow(null),  
  data: joi.object({ 
    uuid: joi.string(),
    type: joi.string().required(),
    createdAt: joi.date(),
    source: joi.string(),
    status: joi.string(),
    data: joi.object({       
      updatedAt: joi.date().required(),
      message: joi.string().allow('').allow(null),      
      status: joi.string().required(),   
      user: joi.object({ 
        email: joi.string().email().required(),
        firstName: joi.string().allow('').allow(null),
        lastName: joi.string().allow('').allow(null),
      }),      
      profile: joi.object({ 
        name: joi.string()
      })      
    })
  })
});

const membershipsRaiselySubscriptionRoute = async (req, res) => {

    const TOKEN_MEMBERSHIP_SUBSCRIPTION = process.env.TOKEN_MEMBERSHIP_SUBSCRIPTION || ""; // this is the API token for posting a job - the NB token is different
    const TOKEN_MEMBERSHIP_SUBSCRIPTION_MEMBERSHIP_NAME = process.env.TOKEN_MEMBERSHIP_SUBSCRIPTION_MEMBERSHIP_NAME || ""; // required - the membership name/id that is created 
    const TOKEN_MEMBERSHIP_SUBSCRIPTION_SHARED_SECRET = process.env.TOKEN_MEMBERSHIP_SUBSCRIPTION_SHARED_SECRET || ""; // optional shared secret sent by subscription provider
    
    const NationbuilderAPI = {}
    NationbuilderAPI.SLUG = process.env.NATIONBUILDER_SLUG || "";  
    NationbuilderAPI.SITE_SLUG = process.env.NATIONBUILDER_SITE_SLUG || "";
    NationbuilderAPI.API_TOKEN = process.env.NATIONBUILDER_API_TOKEN || "";
    
    // derived settings
    NationbuilderAPI.API_URL = process.env.NATIONBUILDER_API_URL || `https://${NationbuilderAPI.SLUG}.nationbuilder.com/api/v1` // derived
    NationbuilderAPI.API_PARAMETERS = process.env.NATIONBUILDER_API_PARAMETERS || `access_token=${NationbuilderAPI.API_TOKEN}`

    try {
      
      // check if this is a empty Raisely test call
      if( req.body && !req.body.data ) {
        console.log(`Raisely Subscriptions Route | INFO | test empty webhook recieved -  ignoring`);
        res.sendStatus(200);
        return;
      }

      // if no token set, this method will not work      
      if( !TOKEN_MEMBERSHIP_SUBSCRIPTION ) {
        console.log(`Raisely Subscriptions Route | WARNING | API route is not active as TOKEN_MEMBERSHIP_SUBSCRIPTION is not set`);
        res.sendStatus(403);
        return;
      }

      // if no token set, this method will not work      
      if( !TOKEN_MEMBERSHIP_SUBSCRIPTION_MEMBERSHIP_NAME ) {
        console.log(`Raisely Subscriptions Route | WARNING | env variable TOKEN_MEMBERSHIP_SUBSCRIPTION_MEMBERSHIP_NAME must be set to the name of the membership to be created`);
        res.sendStatus(403);
        return;
      }
      
      // TEST CODE - LOG FULL PAYLOAD - TO REMOVE
      console.log("** Raisely Subscriptions Route | INFO | webhook recieved **");
      console.log(JSON.stringify(req.body?.data));
      
      // Generate a reduced payload for logging - Raisely sends a pile of rubbish in the payload that clutters the logs      
      let logging_payload = {};
      try {        
        logging_payload = req.body.data ? { ...req.body.data } : {};        
        if( logging_payload.data?.campaign ) { delete logging_payload.data.campaign; }
        if( logging_payload.data?.reciepts ) { delete logging_payload.data.reciepts; }        
        if( logging_payload.data?.result?.source ) { delete logging_payload.data.result.source; }        
        if( logging_payload.data?.receipts ) { delete logging_payload.data.receipts; }
        // disabled info logging
        // console.log(`Raisely Subscriptions Route | INFO | *** REQUEST RECIEVED ***\n${JSON.stringify(logging_payload)}`);
      } catch(error) {
        console.log(`Raisely Subscriptions Route | WARNING | Could not log request: ${JSON.stringify(error)}`);
      }
      
      // Validate optional secret token passed by subscription provider
      // (this route doesn't use normal authentication as we do not create the API call)

      if( TOKEN_MEMBERSHIP_SUBSCRIPTION_SHARED_SECRET && req?.body?.secret !== TOKEN_MEMBERSHIP_SUBSCRIPTION_SHARED_SECRET ) {
        console.log(`Raisely Subscriptions Route | WARNING | payload.secred does not TOKEN_MEMBERSHIP_SUBSCRIPTION_SHARED_SECRET **`);
        res.sendStatus(403);
        return;
      }
            
      // validate payload

      const data = raislyPaymentsSchema.validate(req.body, {      
        allowUnknown: true, // allows other fields
        abortEarly: false // return all errors a payload contains, not just the first one Joi finds
      });
  
      if (data.error) {
        console.log(`Raisely Subscriptions Route | WARNING | payload validation error [error=${JSON.stringify(data.error)}]\n${JSON.stringify(logging_payload)}`);
        res.status(400).json({message: `payload validation error: ${data.error}`});
        return;
      }
            
      const payload = data.value.data;

      // check this is a donation.succeeded webhook, ignore if not

      if( payload.type !== "subscription.cancelled" ) {
        const message = `ignoring - only payloads of type "subscription.cancelled" are currently supported.`;
        console.log(`Raisely Subscriptions Route | WARNING | ${message}\n${JSON.stringify(logging_payload)}`)        
        res.status(200).json({message: message}); // send OK as ignoring
        return;
      }

      const subscription = payload.data;
      
      // check subscription status is OK

      if( subscription.status != "CANCELLED" ) {      
        console.log(`Raisely Subscriptions Route | WARNING | ignoring as payload status is not equal to 'CANCELLED'\n${JSON.stringify(logging_payload)}`);
        res.status(200).json({message: `ignoring as payload status was not 'CANCELLED'`}); // send OK as ignoring        
        return;
      }

      // Get required fields from payload
      
      let email = subscription.user.email; // (required field in joi validation)
            
      // repair common email misspellings that are rejected by Nationbuilder      
      email = email.toLowerCase().trim();
      email = email.replace(/\.con$/, '.com');
      email = email.replace(/\.comp$/, '.com');
      email = email.replace(/\.como$/, '.com');
      email = email.replace(/\.vom$/, '.com');

      const updated_date = subscription.updatedAt; // (required field in joi validation)
              
      let membership_name = TOKEN_MEMBERSHIP_SUBSCRIPTION_MEMBERSHIP_NAME;
      
      // *** TODO - TEMPORARY ***
      // This changes the membership_name based on the donation campaign name
      // This is currently hardcoded as we research a better way to do this!
      if( subscription.profile?.name === "Join Young AJP" || subscription.profile?.name === "young ajp monthly membership" ) {
        membership_name = "Young AJP Member";        
      }      
      // *** / TODO - TEMPORARY ***

      let subscription_message = `Membership cancelled via Payment API. `;
      if( subscription.result?.description ) {
        subscription_message += subscription.result?.description;
      }
                                 
      // Get person from email address - they should exist if cancelling the membership
                  
      let person = null;      
              
      try {

        const response = await peopleAPI.matchByEmail(NationbuilderAPI, email);

        person = response?.person;
        
      } catch(error) {        
        console.log(`Raisely Subscriptions Route | ERROR | exception getting person. [email=${email}, error=${JSON.stringify(error)}]`);
        res.status(404).json({message: `error finding person with email ${email}`}); 
        return;            
      }
      
      // If the person doesn't exist, then there is no membership to cancel
            
      if( !person ) {
        console.log(`Raisely Subscriptions Route | WARNING | Cannot cancel membership as user does not exist. [email=${email}]\n,${JSON.stringify(logging_payload)}`);
        res.status(200).json({message: `membership was not cancelled as email does not exist: ${email}`});        
        return;
      }
            
      // Get persons memberships

      let memberships = [];

      try {

        const response = await membershipsAPI.getMemberships(NationbuilderAPI, person.id, 100);

        memberships = response?.data?.results;

      } catch(error) {
        console.log(`Raisely Subscriptions Route | ERROR | exception getting memberships. [email=${email}, error=${JSON.stringify(error)}]`);
        res.status(500).json({message: "error getting memberships"});
        return;        
      }
      
      // Find if there is an existing membership
      
      const current_memberships = memberships.filter(membership => membership.name === membership_name);

      if( current_memberships.length > 1 ) {
        console.log(`Raisely Subscriptions Route | ERROR | more than one existing active membership for user [email=${email}]`);
        res.status(500).json({message: `error - more than one existing active membership for user ${email}`});
        return;
      }

      const current_membership = current_memberships.length === 1 ? current_memberships[0] : null;
                                    
      // If there is no existing membership, then there is nothing to cancel

      if( !current_membership ) {
        console.log(`Raisely Subscriptions Route | INFO | Cannot cancel membership as an existing membership does not exist. [email=${email}]\n,${JSON.stringify(logging_payload)}`);
        res.status(200).json({message: `membership was not cancelled as existing membership does not exist: ${email}`});        
        return;
      }
            
      // Cancel membership
                      
      current_membership.status = "canceled";
      current_membership.status_reason = subscription_message;
      current_membership.expires_on = updated_date.toISOString().split(".")[0];
        
      try {      

        const response = await membershipsAPI.updateMembership(NationbuilderAPI, person.id, current_membership);
        
        if( !response.membership ) {
          throw new Error("membership was not cancelled");
        }

        console.log(`Raisely Subscriptions Route | INFO | cancelled membership: [email=${email}, membership_name=${membership_name} message=${subscription_message}]`);
                
      } catch(error) {
        console.log(`Raisely Subscriptions Route | ERROR | exception in updateMembership: [email=${email}, error=${JSON.stringify(error)}, payload=${JSON.stringify(subscription)}]`);          
        res.status(403).json({message: `Exception updating membership '${membership_name}' for ${email}.`});        
        return;
      }
      
      // Update the person with a tag to indicated cancelled membership
      
      try {

        const person_data = {
          tags: ["membership_cancelled_via_api"] // (tested updating tags as non-destructive)
        };
            
        await peopleAPI.updatePerson(NationbuilderAPI, person.id, person_data);
                  
      } catch(error) {
        console.log(`Raisely Subscriptions Route | ERROR | Exception updating person. [email=${email}, error=${JSON.stringify(error)}]`);            
        res.status(404).json({message: `error - could update person: ${email}`});        
        return;
      }     

      // Send success response

      res.status(200).json({
        message: `membership '${membership_name}' cancelled for email '${email}'`        
      });

    } catch (error) {    
      console.log(`Raisely Subscriptions Route | ERROR | general exception: ${error.message}`);    
      res.status(503).json({success: false, message: error.message});      
    }
  
};

module.exports = membershipsRaiselySubscriptionRoute;