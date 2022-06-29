// Create Person from Action Network payload
// Currently signature and submission payloads are supported.

const joi = require("joi");
const peopleAPI = require('../nationbuilder-api/people-api');

// schema for Action Network payload
const personCreateActionNetworkSchema = joi.array().min(1).items({  
  // #1 petition
  "osdi:signature": joi.object({
    person: joi.object({
      family_name: joi.string(),
      given_name: joi.string(),
      email_addresses: joi.array().min(1).items({
        address: joi.string().email()
      }),
      postal_addresses: joi.array().items({ 
        postal_code: joi.string(),
        country: joi.string(),
      }),
    }).required(),
    add_tags: joi.array()
  }),
  // #2 form submission
  "osdi:submission": joi.object({
    person: joi.object({
      family_name: joi.string(),
      given_name: joi.string(),
      email_addresses: joi.array().min(1).items({
        address: joi.string().email()
      }),
      postal_addresses: joi.array().items({ 
        postal_code: joi.string(),
        country: joi.string(),
      }),
    }).required(),
    add_tags: joi.array()
  }),
});
  
const personCreateActionNetworkRoute = async (req, res) => {

    const TOKEN_PERSON_CREATE_ACTION_NETWORK = process.env.TOKEN_PERSON_CREATE_ACTION_NETWORK || ""; // this is the API token for posting a job - the NB token is different
  
    const NationbuilderAPI = {}
    NationbuilderAPI.SLUG = process.env.NATIONBUILDER_SLUG || "";  
    NationbuilderAPI.SITE_SLUG = process.env.NATIONBUILDER_SITE_SLUG || "";
    NationbuilderAPI.API_TOKEN = process.env.NATIONBUILDER_API_TOKEN || "";

    // derived settings
    NationbuilderAPI.API_URL = process.env.NATIONBUILDER_API_URL || `https://${NationbuilderAPI.SLUG}.nationbuilder.com/api/v1` // derived
    NationbuilderAPI.API_PARAMETERS = process.env.NATIONBUILDER_API_PARAMETERS || `access_token=${NationbuilderAPI.API_TOKEN}`
    
    // whitelisting 

    // can whitelist fields when creating a person
    NationbuilderAPI.PERSON_CREATE_ACTION_NETWORK_FIELD_WHITELIST = process.env.PERSON_CREATE_ACTION_NETWORK_FIELD_WHITELIST || ""; 
    
    try {

      // if no token set, this method will not work      
      if( !TOKEN_PERSON_CREATE_ACTION_NETWORK ) {
        console.log(`personCreateActionNetworkRoute | WARNING | API route is not active as TOKEN_MEMBERSHIP_PAYMENT is not set`);
        res.sendStatus(403);
        return;
      }

      // check if this is a empty test call
      // if( req.body && !req.body.data ) {
      //   console.log(`personCreateActionNetworkRoute | INFO | test empty webhook recieved -  ignoring`);
      //   res.sendStatus(200);
      //   return;
      // }

      console.log(`*** ACTION NETWORK REQUEST ***\n${JSON.stringify(req?.body)}`);
      
      // validate payload structure

      const data = joi.validate(req.body, personCreateActionNetworkSchema, {      
        allowUnknown: true, // return an error if body has an unrecognised property      
        abortEarly: true // return all errors a payload contains, not just the first one Joi finds
      });
  
      if (data.error) {
        console.log(`personCreateActionNetworkRoute | WARNING | payload validation error [error=${JSON.stringify(data.error)}]\n${JSON.stringify(req?.body)}`);
        res.status(400).end(`payload validation error: ${data.error}`);        
        return;
      }
        
      // get person fields      
      
      let payload = null;

      if( data.value[0]["osdi:signature"] ) {
        payload = data.value[0]["osdi:signature"];
      } 
      else if( data.value[0]["osdi:submission"] ) {
        payload = data.value[0]["osdi:submission"];
      }
      
      const first_name = payload.person.given_name;
      const last_name = payload.person.family_name;

      const primary_email = payload.person.email_addresses?.length > 0 ? payload.person.email_addresses.find(email => email.primary === true) ? payload.person.email_addresses[0] : null : null;
      let email = primary_email?.address;

      if( !email ) { 
        console.log(`personCreateActionNetworkRoute | WARNING | no email found in payload:\n${JSON.stringify(payload)}`);
        res.status(400).end(`payload validation error - no email found`);        
      }
      
      // repair common email misspellings that are rejected by Nationbuilder      
      email = email.toLowerCase().trim();
      email = email.replace(/\.con$/, '.com');
      email = email.replace(/\.comp$/, '.com');
      email = email.replace(/\.como$/, '.com');
      email = email.replace(/\.vom$/, '.com');      
      
      const primary_address = payload.person.postal_addresses?.length > 0 ? payload.person.postal_addresses.find(adrs => adrs.primary === true) ? payload.person.postal_addresses[0] : null : null;
      
      let country_code = primary_address?.country;

      let post_code = primary_address?.postal_code;
      if( post_code ) {
        post_code = post_code?.substring(0, 10); // NB API only accepts 10 chars max for post code
        if( country_code == "US" && post_code.length < 5 ) {
          post_code = null; // NB API only accepts 5 chars for US, any less is not a valid US zip code
        }
      }
            
      const tags = payload.add_tags ?? [];
     
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
          console.log(`personCreateActionNetworkRoute | ERROR | exception getting person. [email=${email}, error=${JSON.stringify(error)}]`);
          res.status(404).json({message: `error finding person with email ${email}`}); 
          return;            
        }
        
        // Create the person if they don't exist
        
        if( !person ) { 
                  
          const new_person = {
            email: email,
            first_name: first_name ?? "Unknown",
            last_name: last_name ?? "Unknown",
            tags: tags
          }
          if( post_code || country_code ) {  
            new_person.home_address = {};
          }
          if( post_code ) {
            new_person.home_address.zip = post_code;
          }
          if( country_code ) {
            new_person.home_address.country_code = country_code;
          }

          try {

            const response = await peopleAPI.createPerson(NationbuilderAPI, new_person);
            
            person = response?.person;
            person_created = true;

            console.log(`personCreateActionNetworkRoute | INFO | created person: [person=${JSON.stringify(new_person)}]`);

          } catch(error) {            
            // disable logging this error - this often happens when multiple webhooks fire at once - log below if all attempts fail
            last_error = `personCreateActionNetworkRoute | WARNING | Exception creating person. Retry attempt ${attempt} [email=${email}, validation_error=${error?.response?.data?.validation_errors ? JSON.stringify(error.response.data.validation_errors) : "None"}, error=${JSON.stringify(error)}]`;            
          }            
      
          attempt++;        
        }
      }
      
      // if the person was not created after 3 attempts, return an error

      if( !person ) {
        console.log(`personCreateActionNetworkRoute | ERROR | Unable to get or create person. [email=${email}], error=${last_error}, payload=${JSON.stringify(payload)}`);
        res.status(404).json({message: `error - could not get or create person: ${email}`});        
        return;
      }

      // if we didn't just create a new person, then we add the tag(s) to the existing person

      if( person_created == false && tags.length > 0 ) {
        
        person.tags = [...person.tags, ...tags];

        try {

          const response = await peopleAPI.updatePerson(NationbuilderAPI, person.id, person);
          
          person = response?.person;
          
          console.log(`personCreateActionNetworkRoute | INFO | updated person: [person={email:${person.email}, first_name:${person.first_name}, last_name:${person.last_name}, tags:${JSON.stringify(person.tags)}}]`);

        } catch(error) {
          console.log(`personCreateActionNetworkRoute | ERROR | Exception updating person. [email=${email}, error=${JSON.stringify(error)}]`);            
          res.status(404).json({message: `error - could update person: ${email}`});        
          return;
        }     
      }

      // Success! Send a response
      
      // Send a simple 200 Response (were getting duplicate calls from Action Network)   
      res.status(200).json({ "message": "person updated" });
            
    } catch (error) {
      console.log(`personCreateActionNetworkRoute | ERROR | general exception: ${error.message}`);    
      res.status(503).json({success: false, message: error.message});      
    }
  
};

module.exports = personCreateActionNetworkRoute;