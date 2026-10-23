import Foundation
let path=CommandLine.arguments[1]
let data=try Data(contentsOf:URL(fileURLWithPath:path))
let root=try JSONSerialization.jsonObject(with:data) as! [String:Any]
let response=root["response"] as! [String:Any]
let requestData=root["request"] as! [String:Any]
let now=try CSMJSONCoding.decoder.decode(Date.self,from:JSONSerialization.data(withJSONObject:root["validationNow"]!,options:.fragmentsAllowed))
func decoded(_ object:[String:Any]) throws -> CSMDriverRouteResponse { try CSMJSONCoding.decoder.decode(CSMDriverRouteResponse.self,from:JSONSerialization.data(withJSONObject:object)) }
let from=CSMRoutePoint(latitude:50.1209513,longitude:17.3831568),access=CSMRoutePoint(latitude:50.1214775,longitude:17.3814008),target=CSMRoutePoint(latitude:50.1215849,longitude:17.3810814)
let request=CSMDriverRouteRequest(from:from,to:access,alternatives:2,includeRoadAttributes:true,arrival:.init(target:target))
func checked(_ object:[String:Any],_ req:CSMDriverRouteRequest=request,_ at:Date=now)throws->CSMDriverRouteResponse {
    try decoded(object).verifyingKnownClosures(for:req,at:at).verifyingMappedProfile(req,at:at).verifyingUserSelectedArrival(req,at:at)
}
var passes=0
@MainActor func require(_ value:Bool,_ name:String){guard value else{fatalError("FAIL "+name)};passes+=1;print("PASS "+name)}
let valid=try checked(response)
require(valid.routes.count==2,"every variant preserved")
require(valid.routes[0].arrival!.distanceM>25,"POI offset greater than25 is not road snap")
require(valid.routes[0].geometry.coordinates.count==3 && valid.routes[0].durationSeconds==49,"geometry and ETA unchanged")
try valid.requireValidKnownClosures(at:now);try valid.requireValidUserSelectedArrival(at:now)
require(true,"current proof admitted")
do{try valid.requireValidUserSelectedArrival(at:now.addingTimeInterval(600));fatalError("expired proof admitted")}catch{require(true,"expiry rechecked")}
let cap=try CSMJSONCoding.decoder.decode(CSMUserSelectedArrivalCapabilities.self,from:JSONSerialization.data(withJSONObject:root["capabilities"]!))
require(cap.permitsUserSelectedArrival,"exact advertised capability")
let requestJSON=try JSONSerialization.jsonObject(with:CSMJSONCoding.encoder.encode(request)) as! [String:Any]
require(NSDictionary(dictionary:requestJSON).isEqual(to:requestData),"explicit request is exactly shared fixture")
let old=CSMDriverRouteRequest(from:from,to:access,alternatives:2,includeRoadAttributes:true)
do{_ = try checked(response,old);fatalError("unsolicited proof accepted")}catch{require(true,"old request cannot consume new proof")}
for mode in ["missingVariant","wrongTarget","wrongAccess","wrongEndpoint","distance","snap","hash","graph","closure","expiry","costing","fallback","feature","unknownField"] {
    var object=response;var routes=object["routes"] as! [[String:Any]];var proof=routes[0]["arrival"] as! [String:Any]
    switch mode {
    case "missingVariant":routes[1].removeValue(forKey:"arrival")
    case "wrongTarget":proof["target"]=["lat":50.13,"lon":17.38]
    case "wrongAccess":proof["requestedAccess"]=["lat":50.13,"lon":17.38]
    case "wrongEndpoint":proof["mappedEndpoint"]=["lat":50.13,"lon":17.38]
    case "distance":proof["distanceM"]=2
    case "snap":proof["snapDistanceM"]=26
    case "hash":proof["requestHash"]=String(repeating:"0",count:64)
    case "graph":proof["routingDataset"]=["version":"wrong","builtAt":"2026-10-23T00:00:00Z"]
    case "closure":proof["closureRevision"]=String(repeating:"0",count:64)
    case "expiry":proof["validUntil"]="2026-10-23T12:00:00Z"
    case "costing":var e=proof["engine"] as! [String:Any];e["costing"]="truck";proof["engine"]=e
    case "fallback":var e=proof["engine"] as! [String:Any];e["fallbackUsed"]=true;proof["engine"]=e
    case "feature":var fs=object["features"] as! [[String:Any]];fs[1]["properties"]=["routeId":"synthetic-arrival-1"];object["features"]=fs
    default:proof["walkingEtaSeconds"]=20
    }
    routes[0]["arrival"]=proof;object["routes"]=routes
    do{_ = try checked(object);fatalError("accepted "+mode)}catch{require(true,"reject "+mode)}
}

// New metadata without opt-in must fail even when it appears only on a feature.
var featureOnly=response
var plainRoutes=featureOnly["routes"] as! [[String:Any]]
for i in plainRoutes.indices { plainRoutes[i].removeValue(forKey:"arrival") }
featureOnly["routes"]=plainRoutes
for check in [0,1] {
    do {
        let raw=try decoded(featureOnly)
        if check==0 { _ = try raw.verifyingUserSelectedArrival(old,at:now) }
        else { try raw.requireValidUserSelectedArrival(at:now) }
        fatalError("feature-only proof accepted")
    } catch { require(true,"feature-only no-optin ordinary gate \(check)") }
}
for field in ["distanceM","snapDistanceM"] {
    var object=response;var routes=object["routes"] as! [[String:Any]];var proof=routes[0]["arrival"] as! [String:Any]
    proof[field]=(proof[field] as! Double)+0.02;routes[0]["arrival"]=proof;object["routes"]=routes
    var fs=object["features"] as! [[String:Any]];var props=fs[0]["properties"] as! [String:Any];props["arrival"]=proof;fs[0]["properties"]=props;object["features"]=fs
    do {_ = try checked(object);fatalError("0.02m mismatch accepted")}catch{require(true,"0.01m tolerance \(field)")}
}
let artifacts=URL(fileURLWithPath:#filePath).deletingLastPathComponent()
func json(_ name:String)throws->[String:Any]{try JSONSerialization.jsonObject(with:Data(contentsOf:artifacts.appendingPathComponent(name)))as![String:Any]}
let mapped=try json("legacy-mapped-car.fixture.json"),profile=try CSMJSONCoding.decoder.decode(CSMMappedVehicleProfile.self,from:JSONSerialization.data(withJSONObject:(mapped["request"]as![String:Any])["vehicleProfile"]!))
let mappedRequest=CSMDriverRouteRequest(from:from,to:access,alternatives:2,includeRoadAttributes:true,vehicleProfile:profile)
let mappedNow=try CSMJSONCoding.decoder.decode(Date.self,from:JSONSerialization.data(withJSONObject:mapped["validationNow"]!,options:.fragmentsAllowed))
var mappedResponse=mapped["response"]as![String:Any]
_ = try checked(mappedResponse,mappedRequest,mappedNow)
require(true,"legacy mapped base accepted")
var mappedFeatures=mappedResponse["features"]as![[String:Any]],mappedProps=mappedFeatures[0]["properties"]as![String:Any]
mappedProps["arrival"]=(response["routes"]as![[String:Any]])[0]["arrival"];mappedFeatures[0]["properties"]=mappedProps;mappedResponse["features"]=mappedFeatures
do{_ = try checked(mappedResponse,mappedRequest,mappedNow);fatalError("mapped feature-only accepted")}catch{require(true,"feature-only no-optin mapped gate")}
let strictRequest=try json("strict-request.json"),strictObject=try json("strict-response.json"),strictManifest=try json("strict-manifest.json")
let trip=try CSMJSONCoding.decoder.decode(CSMRoadTrip.self,from:JSONSerialization.data(withJSONObject:strictRequest["trip"]!))
let strictNow=try CSMJSONCoding.decoder.decode(Date.self,from:JSONSerialization.data(withJSONObject:strictManifest["now"]!,options:.fragmentsAllowed))
_ = try decoded(strictObject).navigationRoutes(for:trip,at:strictNow)
require(true,"legacy strict base accepted")
var strictFeatureOnly=strictObject,varFeatures=strictObject["features"]as![[String:Any]],varProps=varFeatures[0]["properties"]as![String:Any]
varProps["arrival"]=(response["routes"]as![[String:Any]])[0]["arrival"];varFeatures[0]["properties"]=varProps;strictFeatureOnly["features"]=varFeatures
do{_ = try decoded(strictFeatureOnly).navigationRoutes(for:trip,at:strictNow);fatalError("strict feature-only accepted")}catch{require(true,"feature-only no-optin strict gate")}
print("SDK_ARRIVAL_PROOF_TESTS_PASSED \(passes)")
