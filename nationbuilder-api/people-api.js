const axios = require('axios');
const apiUtilities = require('./api-utilities');

const PeopleAPI = {

  matchByEmail: async (apiSettings, email) => {

    email = encodeURIComponent(email);
    
    const url = apiUtilities.GenerateURL(apiSettings, `people/match`, `email=${email}`);

    try {
      var response = await axios({
        method:'get',
        url: url,
        headers: apiUtilities.GenerateHeaders()
      });

      if(response.status !== 200) {
        throw new Error("invalid response code")
      }
      if(!response.data || !response.data.person ) {
        throw new Error("no person found")
      }

      return response.data;

    } catch (e) {
      // an exception is thrown if the person doesn't exist
      // return an empty response object       
      if( e.response && e.response.data && e.response.data.code === "no_matches" ) {        
        return { person: null, message: "person not found" };
      }

      console.log("Exception thrown in PeopleAPI.matchByEmail");
      throw e;
    }
  },

  createPerson: async (apiSettings, person) => {
    
    var url = apiUtilities.GenerateURL(apiSettings, `people`);
            
    try {
      
      const response = await axios.post(url, { person: person }, { headers: apiUtilities.GenerateHeaders() });
    
      if(response.status !== 201) {
        throw new Error("invalid response code")
      }
      if(!response.data || !response.data.person) {
        throw new Error("person was was created")
      }
      
      return response.data;
      
    } catch (e) {
      console.log("Exception thrown in PeopleAPI.createPerson");
      throw e;
    }
  },

  updatePerson: async (apiSettings, id, person) => {
    
    var url = apiUtilities.GenerateURL(apiSettings, `people/${id}`);
            
    try {
            
      const response = await axios.put(url, { person: person }, { headers: apiUtilities.GenerateHeaders() });
    
      if(response.status !== 200) {
        throw new Error("invalid response code")
      }
      if(!response.data || !response.data.person) {
        throw new Error("person was was updated")
      }

      return response.data;
      
    } catch (e) {    
      console.log("Exception thrown in PeopleAPI.updatePerson");
      throw e;
    }
  }
  
}

module.exports = PeopleAPI;
