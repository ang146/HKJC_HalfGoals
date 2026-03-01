export const footballMatchesResultsQuery = `
query matchResults($startDate: String, $endDate: String, $startIndex: Int,$endIndex: Int,$teamId: String) 
{
    timeOffset {
        fb
    }
    matchNumByDate(startDate: $startDate, endDate: $endDate, teamId: $teamId) {
        total
    }
    matches: matchResult(startDate: $startDate, endDate: $endDate, startIndex: $startIndex,endIndex: $endIndex, teamId: $teamId) {
        id
        status
        frontEndId
        matchDayOfWeek
        matchNumber
        matchDate
        kickOffTime
        sequence
        homeTeam {
            id
            name_en
            name_ch
        }
        awayTeam {
            id
            name_en
            name_ch
        }
        tournament {
            code
            name_en
            name_ch
        }
        results {
            homeResult
            awayResult
            ttlCornerResult
            resultConfirmType
            payoutConfirmed
            stageId
            resultType
            sequence
        }
        poolInfo {
            payoutRefundPools
            refundPools
            ntsInfo
            entInfo
            definedPools
            ngsInfo {
                str
                name_en
                name_ch
                instNo
            }
            agsInfo {
                str
                name_en
                name_ch
            }
        }
    }
}`;

// Scrapped from hkjc results page, not used for now, may be useful in the future
// if we want to check the result of the match and send notification based on the result
export const footballMatchResultDetailsQuery = `
query matchResultDetails($matchId: String, $fbOddsTypes: [FBOddsType]!) 
{  
    matches: matchResult(matchId: $matchId) 
    {    
        id    
        foPools(fbOddsTypes: $fbOddsTypes, resultOnly: true) {      
            id      
            status      
            oddsType      
            instNo      
            name_ch      
            name_en      
            lines(resultOnly: true) {        
                combinations {          
                    str          
                    status          
                    winOrd          
                    selections {            
                        selId            
                        str            
                        name_ch            
                        name_en          
                    }        
                }      
            }    
        }       
        additionalResults {      
            resSetId      
            results {        
                awayResult        
                homeResult        
                ttlCornerResult        
                mask        
                payoutConfirmed        
                resultConfirmType        
                resultType        
                sequence        
                stageId      
            }    
        }  
    }
}`;
