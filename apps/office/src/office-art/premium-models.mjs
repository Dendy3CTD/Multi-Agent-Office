// Authored in metres: [X, depth, height]. All shapes export as right-handed Y-up.
const p=(id,size,material,translation=[0,0,0],kind='round',extra={})=>({id,size,material,translation,kind,extra})
const rod=(id,a,b,r,material='metal')=>p(id,[r,1,r],material,[0,0,0],'rod',{between:[a,b]})
const oval=(id,size,material,position)=>p(id,size,material,position,'ellipsoid')
const pots=()=>[
 p('planter',[.28,.21,.45],'ceramic',[0,0,0],'taper'),p('rim',[.285,.285,.04],'ceramic',[0,0,.42],'cylinder'),p('soil',[.24,.24,.025],'carpet',[0,0,.43],'cylinder'),
 ...Array.from({length:9},(_,i)=>{const a=i*2.4,h=.65+i*.09,x=Math.cos(a)*(.25+i%3*.07),z=Math.sin(a)*.3;return [rod(`stem-${i}`,[0,0,.43],[x,z,h],.012,'leaf'),p(`leaf-${i}`,[.19,.045,.44],'leaf',[x,z,h],'leaf',{rotation:[.45*Math.sin(a),a,.45*Math.cos(a)]})]}).flat(),
]
const lounge=(width)=>[
 p('plinth',[width-.12,.7,.12],'oak',[0,0,.15]),
 p('seat',[width,.75,.24],'fabric',[0,-.02,.4]),p('back',[width,.22,.63],'fabric',[0,.29,.72]),
 ...[-1,1].map(sign=>p(`arm-${sign}`,[.18,.76,.46],'fabric',[sign*(width/2-.04),0,.55])),
 ...Array.from({length:width>1?3:1},(_,i)=>p(`cushion-${i}`,[width>1?.63:.6,.64,.13],'fabric-blue',[(i-(width>1?1:0))*.68,-.05,.56])),
 ...[-1,1].map(sign=>p(`pillow-${sign}`,[.36,.16,.32],'fabric-blue',[sign*(width/2-.31),.13,.76],'round',{rotation:[-.12,0,sign*.15]})),
]
export function premiumParts(name, old) {
 if(name==='desk.modern')return [p('top',[1.5,.72,.1],'oak',[0,0,.78]),p('cable-tray',[.9,.18,.06],'metal',[0,.12,.65]),...[-1,1].flatMap(s=>[rod(`front-${s}`,[s*.62,-.24,.05],[s*.62,-.24,.73],.035),rod(`rear-${s}`,[s*.62,.24,.05],[s*.62,.24,.73],.035),p(`foot-${s}`,[.16,.65,.035],'metal',[s*.62,0,.025])]),rod('brace',[-.62,.23,.67],[.62,.23,.67],.022),p('deskmat',[.65,.32,.008],'fabric-blue',[.1,-.16,.834]),p('notebook',[.17,.23,.018],'wall',[-.53,-.1,.845]),p('mug',[.045,.045,.09],'ceramic',[-.57,.18,.84],'cylinder')]
 if(name==='chair.ergonomic')return [p('seat',[.55,.53,.12],'fabric',[0,0,.48]),p('back-shell',[.5,.11,.62],'metal',[0,.22,.83]),p('lumbar',[.44,.07,.2],'fabric',[0,.15,.7]),p('headrest',[.3,.09,.13],'fabric',[0,.19,1.18]),...[-1,1].flatMap(s=>[rod(`arm-support-${s}`,[s*.23,.08,.48],[s*.25,.08,.69],.018),p(`arm-pad-${s}`,[.085,.32,.045],'metal',[s*.25,0,.71])]),...Array.from({length:5},(_,i)=>{const a=i*Math.PI*2/5;const x=Math.cos(a)*.29,z=Math.sin(a)*.29;return [rod(`spoke-${i}`,[0,0,.14],[x,z,.07],.023),oval(`caster-${i}`,[.075,.065,.075],'shoe',[x,z,.055])]}).flat(),p('lift',[.04,.04,.3],'metal',[0,0,.13],'cylinder'),...Array.from({length:6},(_,i)=>p(`mesh-rib-${i}`,[.38,.022,.012],'fabric-blue',[0,.153,.79+i*.045]))]
 if(name.startsWith('monitor.'))return [...old.map(part=>({...part,kind:'round'})),...[-1,1].flatMap(s=>name==='monitor.single'&&s===1?[]:[p(`screen-header-${s}`,[.43,.006,.018],'fabric-blue',[name==='monitor.single'?0:s*.31,-.045,1.14]),...Array.from({length:5},(_,i)=>p(`code-${s}-${i}`,[.18+(i%3)*.06,.006,.009],'leaf',[(name==='monitor.single'?0:s*.31)-.04,-.046,1.09-i*.035]))])]
 if(name==='keyboard')return [p('body',[.5,.2,.025],'metal',[0,0,.84]),...Array.from({length:4},(_,row)=>Array.from({length:12},(_,col)=>p(`key-${row}-${col}`,[.031,.03,.009],'wall',[-.216+col*.039,-.071+row*.043,.861]))).flat(),oval('mouse',[.085,.13,.04],'metal',[.35,0,.857]),p('mouse-seam',[.002,.06,.005],'wall',[.35,-.015,.878])]
 if(name==='sofa.cozy')return lounge(2.2)
 if(name==='armchair.cozy')return lounge(.9)
 if(name==='table.coffee')return [p('top',[1.1,.65,.08],'oak',[0,0,.42]),...[-1,1].flatMap(s=>[rod(`a-${s}`,[s*.4,-.2,.03],[s*.34,-.16,.38],.024,'bronze'),rod(`b-${s}`,[s*.4,.2,.03],[s*.34,.16,.38],.024,'bronze')]),p('book',[.2,.26,.025],'wall',[-.2,0,.48]),p('vase',[.06,.04,.16],'ceramic',[.25,.06,.46],'taper')]
 if(name==='table.meeting')return [p('top',[2.8,1.2,.09],'glass',[0,0,.75]),rod('beam',[-.9,0,.56],[.9,0,.56],.04,'bronze'),...[-1,1].flatMap(s=>[rod(`base-a-${s}`,[s*1.1,-.42,.04],[s*.7,0,.7],.05),rod(`base-b-${s}`,[s*1.1,.42,.04],[s*.7,0,.7],.05)])]
 if(name==='chair.meeting')return [p('seat',[.48,.48,.1],'fabric-blue',[0,0,.48]),p('back',[.48,.1,.5],'fabric-blue',[0,.2,.78]),...[-1,1].flatMap(s=>[rod(`front-${s}`,[s*.2,-.19,.03],[s*.18,-.16,.45],.018,'bronze'),rod(`back-${s}`,[s*.2,.2,.03],[s*.18,.16,.45],.018,'bronze')])]
 if(name==='plant.potted')return pots()
 if(name==='bookshelf')return [p('side-a',[.065,.35,2.1],'oak',[-.62,0,1.05]),p('side-b',[.065,.35,2.1],'oak',[.62,0,1.05]),p('back',[1.2,.035,2.1],'oak',[0,.16,1.05]),...Array.from({length:5},(_,i)=>p(`shelf-${i}`,[1.3,.35,.045],'oak',[0,0,.06+i*.5])),...Array.from({length:16},(_,i)=>p(`book-${i}`,[.06+i%3*.01,.21,.22+i%4*.025],['brick','fabric-blue','wall'][i%3],[-.51+(i%8)*.14,-.03,.24+Math.floor(i/8)*1.0]))]
 if(name==='filing.cabinet')return [p('body',[.75,.65,1.25],'metal',[0,0,.625]),...Array.from({length:3},(_,i)=>[p(`drawer-${i}`,[.67,.025,.35],'oak',[0,-.335,.24+i*.38]),rod(`pull-${i}`,[-.1,-.37,.3+i*.38],[.1,-.37,.3+i*.38],.012,'bronze')]).flat()]
 if(name==='desk.lamp')return [p('base',[.1,.1,.025],'metal',[0,0,.84],'cylinder'),rod('arm-a',[0,0,.87],[0,.1,1.12],.012,'bronze'),rod('arm-b',[0,.1,1.12],[0,-.09,1.25],.012,'bronze'),p('shade',[.12,.06,.12],'bronze',[0,-.09,1.18],'taper'),p('diffuser',[.1,.1,.01],'amber',[0,-.09,1.18],'cylinder')]
 if(name==='pendant.led')return [rod('wire',[0,0,1.35],[0,0,2.3],.009),p('shade',[.35,.12,.18],'bronze',[0,0,1.1],'taper'),p('diffuser',[.32,.32,.025],'amber',[0,0,1.1],'cylinder')]
 if(name==='lamp.standing')return [p('foot',[.22,.22,.04],'metal',[0,0,.02],'cylinder'),rod('pole',[0,0,.03],[0,0,1.9],.018,'bronze'),p('shade',[.26,.18,.3],'wall',[0,0,1.85],'taper')]
 if(name==='window.frame')return [...old.map(part=>({...part,kind:'round'})),p('top',[2.48,.12,.065],'metal',[0,0,2.32]),p('bottom',[2.48,.12,.065],'metal',[0,0,.68]),p('mullion',[.045,.12,1.64],'metal',[0,0,1.5]),p('sill',[2.55,.32,.055],'oak',[0,-.06,.65]),rod('handle',[.96,-.1,1.35],[.96,-.1,1.55],.012,'bronze')]
 if(name==='partition.glass')return [...old,p('top-rail',[2.4,.09,.06],'metal',[0,0,2.23]),p('bottom-rail',[2.4,.09,.06],'metal',[0,0,.04]),rod('door-pull',[.8,-.07,.9],[.8,-.07,1.2],.015,'bronze')]
 if(name==='wall.decoration')return [p('frame',[.9,.06,.65],'bronze',[0,0,.5]),p('art',[.78,.03,.53],'wall',[0,-.05,.5]),...Array.from({length:8},(_,i)=>p(`relief-${i}`,[.025,.025,.2+Math.sin(i)*.1],i%2?'fabric-blue':'bronze',[-.3+i*.085,-.075,.5]))]
 if(name==='wall.brick.loft'||name==='wall.painted')return [...old,p('skirting',[12,.06,.12],'oak',[0,-.14,.06])]
 if(name==='rug.area')return [p('woven',[2.8,1.8,.025],'carpet',[0,0,.015]),...[-1,1].map(s=>p(`border-${s}`,[2.6,.035,.003],'fabric',[0,s*.8,.03]))]
 if(name==='elevator.call-panel')return [p('plate',[.3,.04,.6],'bronze',[-1.38,-.98,1.15]),p('inset',[.24,.015,.52],'metal',[-1.38,-1.01,1.15]),oval('button',[.075,.025,.075],'amber',[-1.38,-1.03,1.3]),p('engraving',[.08,.01,.01],'wall',[-1.38,-1.03,1.05])]
 if(name==='elevator.frame')return [...old,...[-1,1].map(s=>p(`inlay-${s}`,[.025,.025,2.34],'metal',[s*1.16,-1.018,1.28]))]
 if(name==='elevator.cabin')return [...old,rod('handrail',[-.9,.72,1.0],[.9,.72,1.0],.022,'bronze')]
 return old
}
export function premiumCharacter(name, shirt, status, variantIndex) {
 const variant=variantIndex??['idle','working','selected','blocked'].indexOf(status)
 return [oval('pelvis',[.36,.28,.22],'metal',[0,0,.65]),p('body',[.42,.27,.5],shirt,[0,0,.96]),p('collar',[.17,.17,.045],'wall',[0,-.03,1.22]),p('neck',[.065,.065,.12],'skin',[0,0,1.19],'cylinder'),oval('head',[.25,.24,.3],'skin',[0,-.015,1.42]),oval('hair',[.27,.25,.14],'hair',[0,.015,1.55]),...(variant%2?[oval('bun',[.12,.13,.12],'hair',[0,.13,1.56])]:[p('fringe',[.23,.08,.07],'hair',[.015,-.095,1.52])]),oval('nose',[.05,.065,.055],'skin',[0,-.145,1.4]),...[-1,1].flatMap(s=>[
  oval(`ear-${s}`,[.04,.055,.075],'skin',[s*.13,0,1.42]),
  rod(`sleeve-${s}`,[s*.22,0,1.12],[s*.28,-.07,.94],.068,shirt),
  rod(`forearm-${s}`,[s*.28,-.07,.94],[s*.19,-.32,.85],.044,'skin'),oval(`hand-${s}`,[.08,.1,.045],'skin',[s*.19,-.34,.85]),
  rod(`thigh-${s}`,[s*.12,0,.68],[s*.12,-.34,.57],.085,'metal'),rod(`shin-${s}`,[s*.12,-.34,.57],[s*.12,-.36,.15],.065,'metal'),p(`shoe-${s}`,[.14,.28,.1],'shoe',[s*.12,-.42,.08]),
 ]),p('belt',[.37,.27,.035],'shoe',[0,0,.7])]
}
