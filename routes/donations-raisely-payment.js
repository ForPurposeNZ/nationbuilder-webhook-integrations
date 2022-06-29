// Creates donations entry from a payment webhook call originating from Raisly (3rd party payment provider)
//
// Steps:
// 1. Recieves a webhook API call with predefined payload from Raisely
// 2. Looks up the user using their email address in the payload
// 3. Generates donation entry for person using payment data

const joi = require("joi");
const donationsAPI = require('../nationbuilder-api/donations-api');
const peopleAPI = require('../nationbuilder-api/people-api');

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
        email: joi.string().email().required(),
        firstName: joi.string().allow('').allow(null),
        lastName: joi.string().allow('').allow(null)
      }),
      private: joi.object({
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
      }),
      profile: joi.object({ 
        name: joi.string().required()
      }),
      result: joi.object({ 
        description: joi.string()
      }),
    })
  })
});

// raisly webhook - adds donation to nationbuilder
const donationsRaiselyPaymentRoute = async (req, res) => {

  // token required to activate route
  const TOKEN_DONATIONS_RAISELY_PAYMENT = process.env.TOKEN_DONATIONS_RAISELY_PAYMENT || ""; 
  
  // optional shared secret passed by Raisely
  const DONATIONS_RAISELY_PAYMENT_SHARED_SECRET = process.env.DONATIONS_RAISELY_PAYMENT_SHARED_SECRET || ""; 
  
  // optional method how to generate the NB tracking_code_slug:    
  // "profile_name" - (default) use the profile name
  // "profile_name_as_slug" - convert the profile name to slug format (lower case, replace spaces with underscores)
  const DONATIONS_RAISELY_PAYMENT_TRACKING_CODE_TYPE = process.env.DONATIONS_RAISELY_PAYMENT_TRACKING_CODE_TYPE || "profile_name"; 

  // optional customisation - custom donation field name to indicate recurring donation
  const DONATIONS_RAISELY_RECURRENCE_CUSTOM_FIELD = process.env.DONATIONS_RAISELY_RECURRENCE_CUSTOM_FIELD || ""; 

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
      console.log(`donationsRaiselyPayment | INFO | test empty webhook recieved -  ignoring`);
      res.sendStatus(200);
      return;
    }

    // if no token set, this method will not work      
    if( !TOKEN_DONATIONS_RAISELY_PAYMENT ) {
      console.log(`donationsRaiselyPayment | WARNING | API route is not active as TOKEN_DONATIONS_RAISELY_PAYMENT is not set`);
      res.sendStatus(403);
      return;
    }

    // Validate optional secret token passed by payment provider
    // (this route doesn't use normal authentication as we do not create the API call)

    if( DONATIONS_RAISELY_PAYMENT_SHARED_SECRET && req?.body?.secret !== DONATIONS_RAISELY_PAYMENT_SHARED_SECRET ) {
      console.log(`donationsRaiselyPayment | WARNING | payload.secret does not DONATIONS_RAISELY_PAYMENT_SHARED_SECRET **`);
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
      // console.log(`membershipsRaiselyPaymentRoute | INFO | *** REQUEST RECIEVED ***\n${JSON.stringify(logging_payload)}`);
    } catch(error) {
      console.log(`membershipsRaiselyPaymentRoute | WARNING | Could not log request: ${JSON.stringify(error)}`);
    }
    
    // validate payload

    const data = joi.validate(req.body, raislyPaymentsSchema, {      
      allowUnknown: true, // allows other fields
      abortEarly: false // return all errors a payload contains, not just the first one Joi finds
    });

    if (data.error) {
      console.log(`donationsRaiselyPayment | WARNING | payload validation error [error=${JSON.stringify(data.error)}]\n${JSON.stringify(req.body)}`);
      res.status(400).end(`payload validation error: ${data.error}`);
      return;
    }
      
    const payload = data.value.data;

    // check this is a donation.succeeded webhook, ignore if not

    if( payload.type !== "donation.succeeded" ) {
      const message = `validation error - data field "type" must be "donation.succeeded" **`;
      console.log(`donationsRaiselyPayment | WARNING | ${message}\n${JSON.stringify(payload)}`)
      res.status(400).json({message: message});
      return;
    }
    
    const payment = payload.data;

    // check payment status is OK

    if( payment.status != "OK" ) {      
      console.log(`donationsRaiselyPayment | WARNING | payload payment status is not equal to 'OK'\n${JSON.stringify(payload)}`);
      res.status(400).end(`payload validation error: status was not 'OK'`);
      res.sendStatus(400).end(error);
      return;
    }
    
    // Get or create person from email address
    
    let email = payment.email;
    // repair common email misspellings that are rejected by Nationbuilder
    email = email.toLowerCase().trim();
    email = email.replace(/\.con$/, '.com');
    email = email.replace(/\.comp$/, '.com');
    email = email.replace(/\.como$/, '.com');
    email = email.replace(/\.vom$/, '.com');
    
    const first_name = payment.user?.firstName ?? payment.result?.metadata?.first_name ?? "Unknown";
    const last_name = payment.user?.lastName ?? payment.result?.metadata?.last_name ?? "Unknown";

    // Additional person info to create or update

    const person_data = {};
        
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

    let person = null;      
    
    // Note we attempt to get/create the person a few times. If two webhooks fire at once, its possible that 
    // the person is created between checking and trying to create the person!
    let attempt = 1;      
    let person_created = false;  
    while( !person && attempt <= 3) {
      
      try {

        const response = await peopleAPI.matchByEmail(NationbuilderAPI, email);

        person = response?.person;

      } catch(error) {        
        console.log(`donationsRaiselyPayment | ERROR | exception getting person. [email=${email}, error=${JSON.stringify(error)}]`);
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
        person_data.tags.push("created_via_donation_payment");

        try {

          const response = await peopleAPI.createPerson(NationbuilderAPI, person_data);
          
          person = response?.person;
          person_created = true;

          console.log(`donationsRaiselyPayment | INFO | created person: [person={email:${person.email}, first_name:${person.first_name}, last_name:${person.last_name}, tags:${JSON.stringify(person.tags)}}, billing_address:${JSON.stringify(person.billing_address)}}, payload=${JSON.stringify(logging_payload)}]`);

        } catch(error) {
          // disable logging this error - this often happens when multiple webhooks fire at once - log below if all attempts fail
          // console.log(`donationsRaiselyPayment | WARNING | Exception creating person. Retry attempt ${attempt} [email=${email}, error=${JSON.stringify(error)}]`);            
        }            
      }

      attempt++;        
    }
  
    if( !person ) {
      console.log(`donationsRaiselyPayment | ERROR | Unable to get or create person. [email=${email}]\n,${JSON.stringify(payload)}`);
      res.status(404).json({message: `error - could not get or create person: ${email}`});        
      return;
    }

    // if we didn't just create a new person, then we update the person with new tags and personal info

    if( !person_created ) {
      try {
        
        const response = await peopleAPI.updatePerson(NationbuilderAPI, person.id, person_data);
        
        person = response?.person;
        
        console.log(`donationsRaiselyPayment | INFO | updated person: [person={email:${person.email}, first_name:${person.first_name}, last_name:${person.last_name}, tags:${JSON.stringify(person.tags)}}, billing_address:${JSON.stringify(person.billing_address)}}, payload=${JSON.stringify(logging_payload)}]`);

      } catch(error) {
        console.log(`donationsRaiselyPayment | ERROR | Exception updating person. [email=${email}, error=${JSON.stringify(error)}]`);            
        res.status(404).json({message: `error - could update person: ${email}`});        
        return;
      }     
    }

    // Generate donation payload

    const donation = {
      donor_id: person.id,
      amount_in_cents: payment.amount,
      payment_type_name: "Credit Card",
      note: `${payment.result?.description ?? ""}${payment.message ? ` - ${payment.message}` : `` }`,
      succeeded_at: payment.date
    };

    // Set tracking_code_slug based on method type
    
    switch( DONATIONS_RAISELY_PAYMENT_TRACKING_CODE_TYPE ) {
      case "profile_name_as_slug":
        donation.tracking_code_slug = payment.profile?.name ? payment.profile.name.toLowerCase().replace(/'/g, '').replace(/ /g, '_') : "";
        break;
      default: // profile name
        donation.tracking_code_slug = payment.profile?.name ?? "";
    }

    // Custom option: add recurrence info if the custom field is set 

    if( DONATIONS_RAISELY_RECURRENCE_CUSTOM_FIELD ) {
      donation[DONATIONS_RAISELY_RECURRENCE_CUSTOM_FIELD] = ( donation.processing == "RECURRING" );
    }

    try {  
      const response = await donationsAPI.createDonation(NationbuilderAPI, donation);

      if( !response.donation ) {
        throw new Error("donation was not created");
      } 

    } catch (error) {
      console.log(`donationsRaiselyPayment | ERROR | exception creating donation: [email=${payment.email}, error=${JSON.stringify(error)}, payload=${JSON.stringify(payment)}]`);
      res.status(403).json({message: `Exception creating donation for ${payment.email}.`});        
      return;
    }
    
    // log donation created
    console.log(`donationsRaiselyPayment | INFO | added donation: [email=${email}, donation=${JSON.stringify(donation)}]`);

    // success! Send 201 (OK - created)    
    res.status(201).json({
      message: "donation created"        
    });

  } catch (error) {
    console.log(`donationsRaiselyPayment | ERROR | general exception: ${error.message}`);    
    res.status(503).json({success: false, message: error.message});
  }

}

module.exports = donationsRaiselyPaymentRoute;