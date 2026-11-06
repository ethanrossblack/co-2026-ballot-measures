// Stand-in for topojson-client's `feature()`, enough for the embedded Colorado TopoJSON
// (quantized arcs with a transform; Polygon / MultiPolygon geometries). Used only by e2e-test.js
// so the page can run with no network access.
window.topojson={feature(topo,obj){
 const {scale:[sx,sy],translate:[tx,ty]}=topo.transform;
 const arcs=topo.arcs.map(a=>{let x=0,y=0;return a.map(([dx,dy])=>{x+=dx;y+=dy;return [x*sx+tx,y*sy+ty]})});
 const ring=r=>{let pts=[];r.forEach((i,k)=>{let a=i<0?arcs[~i].slice().reverse():arcs[i];pts=pts.concat(k?a.slice(1):a)});return pts};
 return {type:"FeatureCollection",features:obj.geometries.map(g=>({type:"Feature",id:g.id,properties:g.properties,geometry:{type:g.type,coordinates:g.type==="Polygon"?g.arcs.map(ring):g.arcs.map(p=>p.map(ring))}}))};
}};
