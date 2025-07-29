/**
 * @typedef {Object} PEPResult
 * @property {string} source_list_url - URL of the source list
 * @property {string} data_hash - Hash of the data
 * @property {string} entity_type - Type of entity (e.g., "Individual")
 * @property {string[]} nationality - Array of nationality codes
 * @property {number} confidence_score - Confidence score (0-1)
 * @property {string} name - Name of the entity
 * @property {string} si_identifier - sanctions io identifier for the result type
 * @property {string} title - Entity's title
 * @property {Object} data_source - Data source information
 * @property {string} data_source.name - Full name of the data source
 * @property {string} data_source.short_name - Short name of the data source
 */

/**
 * Parse a statement from the sanctions io results for the user to certify.
 * @param {Array<PEPResult>} results - Array of PEP results from sanctions io 
 */
export function parseStatementForUserCertification(results) {
  const names = results.map(result => {
    if (result.name && result.title) {
      return `${result.name} (${result.title})`
    }

    if (result.name) {
      return result.name
    }

    if (result.title) {
      return `<unknown> (${result.title})`
    }
  })

  return 'I certify that I am not any of the following Politically ' +
  'Exposed Persons who have a similar name: ' + names.join(', ')
}
