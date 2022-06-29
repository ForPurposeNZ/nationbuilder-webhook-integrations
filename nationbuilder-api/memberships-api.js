const axios = require('axios');
const apiUtilities = require('./api-utilities');

const MembershipsAPI = {

  // gets list entries (up to 100)
  getMemberships: async (api_settings, person_id, limit, next_page_nonce, next_page_token) => {

    const params = `limit=${limit ? limit : "100"}${next_page_nonce ? "&__nonce=" + next_page_nonce : ""}${next_page_token ? "&__token=" + next_page_token : ""}`;

    const url = apiUtilities.GenerateURL(api_settings, `people/${person_id}/memberships`, params);

    try {
      var response = await axios({
        method: 'get',
        url: url,
        headers: apiUtilities.GenerateHeaders()
      });

      if (response.status !== 200) {
        throw new Error("invalid response code");
      }

      if (!response.data || !response.data.results) {
        return null;
      }

      return response;

    } catch (e) {
      console.log("Exception thrown in MembershipsAPI.getMemberships");
      console.dir(e);
      throw e;
    }
  },

  createMembership: async (apiSettings, person_id, membership) => {

    const url = apiUtilities.GenerateURL(apiSettings, `people/${person_id}/memberships`);

    try {
      
      var response = await axios({
        method:'post',
        url: url,
        headers: apiUtilities.GenerateHeaders(),
        data: JSON.stringify({ membership: membership })
      });
      
      if(response.status !== 200) {
        throw new Error("invalid response code")
      }
      
      if(!response.data || !response.data.membership) {
        throw new Error("membership was not created")
      }

      return response.data;

    } catch (e) {        
      console.log("Exception thrown in MembershipsAPI.createMembership");
      console.dir(e);
      throw e;
    }    
  },

  updateMembership: async (apiSettings, person_id, membership) => {
    
    const url = apiUtilities.GenerateURL(apiSettings, `people/${person_id}/memberships`);

    try {
      
      var response = await axios({
        method:'put',
        url: url,
        headers: apiUtilities.GenerateHeaders(),
        data: JSON.stringify({ membership: membership })
      });
      
      if(response.status !== 200) {
        throw new Error("invalid response code")
      }
      if(!response.data || !response.data.membership) {
        throw new Error("membership was not updated")
      }

      return response.data;

    } catch (e) {   
      
      console.log("Exception thrown in MembershipsAPI.updateMembership");
      console.dir(e);
      throw e;
    }    
  }
}

module.exports = MembershipsAPI;
