refresh token duration ko 15 days ka rkho
trips me search option dalo with phone num aise to  hm fronted se kr diye h abhi k liye but ye b backend se hoga to app pr load kam pdega
kabhi kabhi data ane time lgra h api se dkh lena. (trips me)
dkho extra commas b ara h res me (/trips endpoint me or /trips/:id endpoint me)
  "receiveCard": {
      "receivedAt": "2026-02-06T08:09:53.522Z",
      "remarks": "Minor shortage in Cabbage",
      "status": "PENDING",
      "totalItems": 2,
      "totalQuantity": 540,
      "totalAmount": 27100,
      "totalShortage": 10,  --->> (crate , kg , bora , peice ) me se kiya h   

      /trips/:id me receiveCard me 
      "shortagePercent": 1.82,
      "createdBy": "Ramu Driver",

      remarks me photos b dlne ka  option rkho jo ki mandatory krdo

      check kro payment or chat wala kiye krna h prisma ya aise hp jyega 


create trip ka logic thik kro 
{
  "sourceOrgId": "string (required)",
  "destinationOrgId": "string (required)",
  "truckId": "string (required)",
  "driverId": "string (optional)",
  "pendingDriverPhone": "string (optional if driver not registered)",
  "startPoint": "string (optional)",
  "endPoint": "string (optional)",
  "estimatedDistance": 120.5,
  "estimatedArrival": "2026-02-15T10:00:00.000Z",
  "notes": "Handle carefully"
}
  phone num se chk kro backend me available h ya nhi then ni h res null bhjo hm yhn se tmko name phone num city bhej denge 
  addb ko b shi se format me lelo thora pincode , state, city 
  landmark, add 


chat ka dkhlo phle kaise krna h phr hoga ab usme kam

  
       