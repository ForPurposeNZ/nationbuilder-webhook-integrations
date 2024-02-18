// Updates person membership from a webhook call originating from Raisly (3rd party payment provider)
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
    data: joi.object({ 
      amount: joi.number().required(),
      message: joi.string().allow('').allow(null),
      date: joi.date().required(),
      status: joi.string().required(),   
      email: joi.string().email().required(),
      processing: joi.string().required(),
      user: joi.object({ 
        email: joi.string().email(),
        firstName: joi.string().allow('').allow(null),
        lastName: joi.string().allow('').allow(null),
      }),
      private: joi.object({
        // normal address fields
        street_address: joi.string(),
        suburb: joi.string(),
        postcode: joi.string(),
        state: joi.string(),        
        phone_number: joi.string(),
        date_of_birth: joi.string(),
        // alternative (paypal) address fields
        textAddress1: joi.string(),
        textSuburb: joi.string(),
        textState: joi.string(),
        textPostcode: joi.string(),
        textCountry: joi.string()
      }).allow(null),
      profile: joi.object({ 
        name: joi.string()
      }),
      result: joi.object({ 
        description: joi.string()
      }),
    })
  })
});

const membershipsRaiselyPaymentRoute = async (req, res) => {

    const TOKEN_MEMBERSHIP_PAYMENT = process.env.TOKEN_MEMBERSHIP_PAYMENT || ""; // this is the API token for posting a job - the NB token is different
    const TOKEN_MEMBERSHIP_PAYMENT_MEMBERSHIP_NAME = process.env.TOKEN_MEMBERSHIP_PAYMENT_MEMBERSHIP_NAME || ""; // required - the membership name/id that is created 
    const TOKEN_MEMBERSHIP_PAYMENT_SHARED_SECRET = process.env.TOKEN_MEMBERSHIP_PAYMENT_SHARED_SECRET || ""; // optional shared secret sent by payment provider
    
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
        console.log(`Raisely Payments Route | INFO | test empty webhook recieved -  ignoring`);
        res.sendStatus(200);
        return;
      }

      // if no token set, this method will not work      
      if( !TOKEN_MEMBERSHIP_PAYMENT ) {
        console.log(`Raisely Payments Route | WARNING | API route is not active as TOKEN_MEMBERSHIP_PAYMENT is not set`);
        res.sendStatus(403);
        return;
      }

      // if no token set, this method will not work      
      if( !TOKEN_MEMBERSHIP_PAYMENT_MEMBERSHIP_NAME ) {
        console.log(`Raisely Payments Route | WARNING | env variable TOKEN_MEMBERSHIP_PAYMENT_MEMBERSHIP_NAME must be set to the name of the membership to be created`);
        res.sendStatus(403);
        return;
      }
      
      // Generate a reduced payload for logging - Raisely sends a pile of rubbish in the payload that clutters the logs      
      let logging_payload = {};
      try {        
        logging_payload = req.body.data ? { ...req.body.data } : {};        
        if( logging_payload.data?.campaign ) { delete logging_payload.data.campaign; }
        if( logging_payload.data?.reciepts ) { delete logging_payload.data.reciepts; }
        if( logging_payload.data?.profile?.campaign?.config ) { delete logging_payload.data.profile.campaign.config; }
        if( logging_payload.data?.result?.balance_transaction ) { delete logging_payload.data.result.balance_transaction; }
        if( logging_payload.data?.result?.outcome ) { delete logging_payload.data.result.outcome; }
        if( logging_payload.data?.result?.payment_method_details ) { delete logging_payload.data.result.payment_method_details; }
        if( logging_payload.data?.result?.refunds ) { delete logging_payload.data.result.refunds; }
        if( logging_payload.data?.result?.source ) { delete logging_payload.data.result.source; }        
        if( logging_payload.data?.receipts ) { delete logging_payload.data.receipts; }
        // disabled info logging
        // console.log(`Raisely Payments Route | INFO | *** REQUEST RECIEVED ***\n${JSON.stringify(logging_payload)}`);
      } catch(error) {
        console.log(`Raisely Payments Route | WARNING | Could not log request: ${JSON.stringify(error)}`);
      }
      
      // Validate optional secret token passed by payment provider
      // (this route doesn't use normal authentication as we do not create the API call)

      if( TOKEN_MEMBERSHIP_PAYMENT_SHARED_SECRET && req?.body?.secret !== TOKEN_MEMBERSHIP_PAYMENT_SHARED_SECRET ) {
        console.log(`Raisely Payments Route | WARNING | payload.secred does not TOKEN_MEMBERSHIP_PAYMENT_SHARED_SECRET **`);
        res.sendStatus(403);
        return;
      }
            
      // validate payload

      const data = raislyPaymentsSchema.validate(req.body, {      
        allowUnknown: true, // allows other fields
        abortEarly: false // return all errors a payload contains, not just the first one Joi finds
      });
  
      if (data.error) {
        console.log(`Raisely Payments Route | WARNING | payload validation error [error=${JSON.stringify(data.error)}]\n${JSON.stringify(logging_payload)}`);
        res.status(400).end(`payload validation error: ${data.error}`);
        return;
      }
            
      const payload = data.value.data;

      // check this is a donation.succeeded webhook, ignore if not

      if( payload.type !== "donation.succeeded" ) {
        const message = `validation error - data field "type" must be "donation.succeeded" **`;
        console.log(`Raisely Payments Route | WARNING | ${message}\n${JSON.stringify(logging_payload)}`)
        res.status(400).json({message: message});
        return;
      }

      const payment = payload.data;
      
      // check payment status is OK

      if( payment.status != "OK" ) {      
        console.log(`Raisely Payments Route | WARNING | payload status is not equal to 'OK'\n${JSON.stringify(logging_payload)}`);
        res.status(400).end(`payload validation error: status was not 'OK'`);
        res.sendStatus(400).end(error);
        return;
      }

      // Get required fields from payload
      
      let email = payment.email;
      // repair common email misspellings that are rejected by Nationbuilder      
      email = email.toLowerCase().trim();
      email = email.replace(/\.con$/, '.com');
      email = email.replace(/\.comp$/, '.com');
      email = email.replace(/\.como$/, '.com');
      email = email.replace(/\.vom$/, '.com');

      const payment_date = payment.date; 
      const recurring_payment = payment.processing === "RECURRING";
      
      const first_name = payment.user?.firstName ?? payment.result?.metadata?.first_name ?? "Unknown";
      const last_name = payment.user?.lastName ?? payment.result?.metadata?.last_name ?? "Unknown";

      let membership_name = TOKEN_MEMBERSHIP_PAYMENT_MEMBERSHIP_NAME;
      let membership_extension_months = 12; // default to 12 months/1 year membership extension

      // *** TODO - TEMPORARY ***
      // This changes the membership_name based on the donation campaign name
      // This is currently hardcoded as we research a better way to do this!
      if( payment.profile?.name === "Join Young AJP" || payment.profile?.name === "young ajp monthly membership" ) {
        membership_name = "Young AJP Member";        
      }
      if( payment.profile?.name === "young ajp monthly membership" ) {
        membership_extension_months = 1;
      }
      // *** / TODO - TEMPORARY ***

      let payment_message = `Membership extended ${membership_extension_months} month(s) via Payment API. `;
      if( payment.result?.description ) {
        payment_message += payment.result?.description;
      }
      
      // additional person info to create or update

      const person_data = {};
      
      // If the donation is recurring, tag the user "recurring_membership"                  
      if( recurring_payment ) { 
        person_data.tags = ["recurring_membership"]; // (tested adding tags on update non-destructive)
      }

      if( payment.private?.phone_number ) { 
        person_data.phone = payment.private?.phone_number;
      }

      if( payment.private?.date_of_birth ) {   
        // convert possible date formats to YYYY-MM-DD (NB format)
        let date_string = payment.private?.date_of_birth;
        if( date_string.includes("/")) {
          date_string = date_string.split("/").reverse().join("-");
        }         
        try {
          const date_object = new Date(date_string);
          person_data.birthdate = date_object.toISOString().split('T')[0];
        } catch {}; // ignore if there is a format error
      }
      
      // get address fields. Note alternative address field possibilities (that Paypal seems to use)
      const address1 = payment.private?.street_address ?? payment.private?.textAddress1 ?? "";
      const state = payment.private?.state ?? payment.private?.textState ?? "";
      const suburb = payment.private?.suburb ?? payment.private?.textSuburb ?? "";
      const postcode = payment.private?.postcode ?? payment.private?.textPostcode ?? "";
      
      if( address1 || state || suburb || postcode ) {
        person_data.billing_address = {};
        if( address1 ) {
          person_data.billing_address.address1 = address1;
        }
        if( suburb ) {      
          person_data.billing_address.address2 = suburb; // NB doesn't have suburb field
        }
        if( state ) {
          person_data.billing_address.state = state;
        }        
        if( postcode ) {
          person_data.billing_address.zip = postcode.substring(0, 10); // NB API only accepts 10 chars
        }
      }
           
      // Get or create person from email address
                  
      let person = null;      
      
      // Note we attempt to get/create the person a few times. If two webhooks fire at once, its possible that 
      // the person is created between checking and trying to create the person!
      let attempt = 1;    
      let person_created = false;  
      let last_error = "";
      
      while( !person && attempt <= 3) {
        
        try {

          const response = await peopleAPI.matchByEmail(NationbuilderAPI, email);

          person = response?.person;
          
        } catch(error) {        
          console.log(`Raisely Payments Route | ERROR | exception getting person. [email=${email}, error=${JSON.stringify(error)}]`);
          res.status(404).json({message: `error finding person with email ${email}`}); 
          return;            
        }
        
        // Create the person if they don't exist
        
        if( !person ) { 
        
          // Add fields for creating a new person          
          person_data.email = email;
          person_data.first_name = first_name;
          person_data.last_name = last_name;
          
          if( !person_data.tags ) {
            person_data.tags = [];
          }
          person_data.tags.push("created_via_membership_payment");

          try {

            const response = await peopleAPI.createPerson(NationbuilderAPI, person_data);
            
            person = response?.person;
            person_created = true;

            console.log(`Raisely Payments Route | INFO | created person: [person={email:${person.email}, first_name:${person.first_name}, last_name:${person.last_name}, tags:${JSON.stringify(person.tags)}}, billing_address:${JSON.stringify(person.billing_address)}}, payload=${JSON.stringify(logging_payload)}]`);

          } catch(error) {
            // store the error and only log it if all attempts fail
            last_error = `Raisely Payments Route | WARNING | Exception creating person. Retry attempt ${attempt} [email=${email}, error=${JSON.stringify(error)}]`;            
          }            
        }

        attempt++;        
      }
    
      if( !person ) {
        console.log(`Raisely Payments Route | ERROR | Unable to get or create person. [email=${email}], error=${last_error}, payload=${JSON.stringify(logging_payload)}`);
        res.status(404).json({message: `error - could not get or create person: ${email}`});        
        return;
      }

      // if we didn't just create a new person, then we update the person with new tags and personal info

      if( !person_created ) {
        try {
          
          const response = await peopleAPI.updatePerson(NationbuilderAPI, person.id, person_data);
          
          person = response?.person;
                    
        } catch(error) {
          console.log(`Raisely Payments Route | ERROR | Exception updating person. [email=${email}, error=${JSON.stringify(error)}]`);            
          res.status(404).json({message: `error - could update person: ${email}`});        
          return;
        }     
      }
      
      // Get persons memberships

      let memberships = [];

      try {

        const response = await membershipsAPI.getMemberships(NationbuilderAPI, person.id, 100);

        memberships = response?.data?.results;

      } catch(error) {
        console.log(`Raisely Payments Route | ERROR | exception getting memberships. [email=${email}, error=${JSON.stringify(error)}]`);
        res.status(500).json({message: "error getting memberships"});
        return;        
      }
      
      // Find if there is an existing membership
      
      const current_memberships = memberships.filter(membership => membership.name === membership_name);

      if( current_memberships.length > 1 ) {
        console.log(`Raisely Payments Route | ERROR | more than one existing active membership for user [email=${email}]`);
        res.status(500).json({message: `error - more than one existing active membership for user ${email}`});
        return;
      }

      const current_membership = current_memberships.length === 1 ? current_memberships[0] : null;
                                    
      // Create or update existing membership

      if( !current_membership ) {

        // Create a new membership
        
        // Set membership start and end dates
        var start_date = new Date(payment_date);
        var end_date = new Date(payment_date);        
        end_date.setMonth(end_date.getMonth() + membership_extension_months);    
        // Add extra day of membership due to Raisely vs Nationbuilder rollover mismatch causing emails to be sent on the wrong day    
        end_date.setDate(end_date.getDate() + 1);
        var start_date_iso = start_date.toISOString().split(".")[0];      
        var end_date_iso = end_date.toISOString().split(".")[0];

        const membership = {          
          name: membership_name,
          status: "active",
          status_reason: payment_message,
          started_at: start_date_iso,
          expires_on: end_date_iso
        }
          
        try {       

          const response = await membershipsAPI.createMembership(NationbuilderAPI, person.id, membership);
          
          if( !response.membership ) {
            throw new Error("membership was not created");
          }

          console.log(`Raisely Payments Route | INFO | created membership: [email=${email}, membership_name=${membership_name}, message=${payment_message}]`);

          res.status(201).json({
            message: "membership created"        
          });

        } catch(error) {
          console.log(`Raisely Payments Route | ERROR | exception in createMembership: [email=${email}, error=${JSON.stringify(error)}, payload=${JSON.stringify(payment)}]`);                    
          res.status(403).json({message: `Exception creating membership for ${email}.`});        
          return;
        }

      } else {

        // Update existing membership
        
        // If there is a membership but there is no expiry date, then there is no need to update anything
        if( !current_membership.expires_on ) {
          res.status(200).json({
            message: "membership already has no end date"        
          });
          return;
        }

        // Extend existing membership by one year
        current_membership.status = "active";
        current_membership.status_reason = payment_message;

        //var current_date = new Date(payment_date); 
        current_payment_date = new Date(payment_date);
        current_membership_expiry_date = new Date(current_membership.expires_on);

        // use the existing membership expiry date if greater than the payment date
        let new_expiry_date = current_membership_expiry_date > current_payment_date ? current_membership_expiry_date : current_payment_date;        
        new_expiry_date.setMonth(new_expiry_date.getMonth() + membership_extension_months);
         
        // Add extra day of membership due to Raisely vs Nationbuilder rollover mismatch causing emails to be sent on the wrong day        
        new_expiry_date.setDate(new_expiry_date.getDate() + 1);

        current_membership.expires_on = new_expiry_date.toISOString().split(".")[0];

        try {      

          const response = await membershipsAPI.updateMembership(NationbuilderAPI, person.id, current_membership);
         
          if( !response.membership ) {
            throw new Error("membership was not updated");
          }

          console.log(`Raisely Payments Route | INFO | updated membership: [email=${email}, membership_name=${membership_name}, message=${payment_message}]`);
          
          res.status(200).json({
            message: "membership updated"        
          });

        } catch(error) {
          console.log(`Raisely Payments Route | ERROR | exception in updateMembership: [email=${email}, error=${JSON.stringify(error)}, payload=${JSON.stringify(payment)}]`);          
          res.status(403).json({message: `Exception updating membership for ${email}.`});        
          return;
        }
      }  

    } catch (error) {  
      console.log(`Raisely Payments Route  | ERROR | general exception: ${error.message}`);    
      res.status(503).json({success: false, message: error.message});      
    }
  
};

module.exports = membershipsRaiselyPaymentRoute;