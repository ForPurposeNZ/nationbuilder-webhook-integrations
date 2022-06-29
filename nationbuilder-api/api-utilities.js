// API Utilties - Assists one to switch between Heroku and NationBuilder

const APIUtilities = {}

// Returns the full URL for an API call
APIUtilities.GenerateURL = (apiSettings, path, parameters) => {

  let url = apiSettings.API_URL

  url += `/${path}`

  if( parameters ) {
    url += `?${parameters}`
  }

  // add the API token
  if( parameters ) {
    url += '&'
  } else {
    url += '?'
  }

  url += apiSettings.API_PARAMETERS
  
  return url
} 

APIUtilities.GenerateHeaders = () => {
  const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  }
   
  return headers
}

module.exports = APIUtilities