// Nationbuilder Donations API

const axios = require('axios');
const apiUtilities = require('./api-utilities');

const donationsAPI = {

  createDonation: async (apiSettings, donation) => {

    const url = apiUtilities.GenerateURL(apiSettings, `donations`);

    try {
      var response = await axios({
        method:'post',
        url: url,
        headers: apiUtilities.GenerateHeaders(),
        data: JSON.stringify({ donation: donation })
      });

      if(response.status !== 200) {
        throw new Error("invalid response code")
      }
      if(!response.data || !response.data.donation) {
        throw new Error("donation was not created")
      }

      return response.data;

    } catch (e) {
      console.log("Exception thrown in createDonation");
      console.dir(e);
      throw e;
    }    
  }
}

module.exports = donationsAPI;