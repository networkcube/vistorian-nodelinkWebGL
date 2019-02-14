import * as dynamicgraph from 'vistorian-core/src/dynamicgraph';
import * as utils from 'vistorian-core/src/utils';
import * as main from 'vistorian-core/src/main';
import * as messenger from 'vistorian-core/src/messenger';

import * as ui from 'vistorian-widgets/src/ui';
import * as timeslider from 'vistorian-widgets/src/timeslider';
import * as glutils from 'vistorian-widgets/src/glutils';

import * as d3 from 'd3'

var COLOR_DEFAULT_LINK: string = '#999999';
var COLOR_DEFAULT_NODE: string = '#333333';
var COLOR_HIGHLIGHT: string = '#ff8800';
var LINK_OPACITY: number = .5;
var LINK_WIDTH: number = 10;
var OFFSET_LABEL = { x: 0, y: 10 }
var LINK_GAP: number = 2;
var LAYOUT_TIMEOUT: number = 3000;
var LABELBACKGROUND_OPACITY: number = 1;
var LABELDISTANCE: number = 10;
var SLIDER_WIDTH: number = 100
var SLIDER_HEIGHT: number = 35;
var NODE_SIZE: number = 1;


var width: number = window.innerWidth
var height: number = window.innerHeight - 100;

interface Bounds {
    left: number;
    top: number;
}
var margin: Bounds = { left: 20, top: 20 };
var TIMELINE_HEIGHT: number = 50;

var currentLayout: string = 'forceDirected';
var positions: Object = new Object();
(positions as any)['forceDirected'] = [];

// get dynamic graph
var dgraph: dynamicgraph.DynamicGraph = main.getDynamicGraph();
var times: dynamicgraph.Time[] = dgraph.times().toArray();
var time_start: dynamicgraph.Time = times[0];
var time_end: dynamicgraph.Time = times[times.length - 1];

var nodes: any = dgraph.nodes().toArray();
var nodesOrderedByDegree: dynamicgraph.Node[] = dgraph.nodes().toArray().sort((n1, n2) => n2.neighbors().length - n1.neighbors().length);

var nodePairs: dynamicgraph.NodePairQuery = dgraph.nodePairs();
var links: any = dgraph.links().toArray();
var nodeLength: number = nodes.length;



// states
var mouseDownNode: any = undefined;
var hiddenLabels: any = [];
var LABELING_STRATEGY: number = 1;

var linkWeightScale = d3.scale.linear().range([0, LINK_WIDTH]);
linkWeightScale.domain([
    0,
    dgraph.links().weights().max()
]);

messenger.setDefaultEventListener(updateEvent);


// GENERAL LISTENERS
var shiftDown = false;
$(document).on('keyup keydown', function (e) { shiftDown = e.shiftKey });
$(document).on('mousemove', (e) => {
    if (mouseDownNode != undefined) {
        var mousePos = glutils.mouseToWorldCoordinates(e.clientX, e.clientY)
        mouseDownNode.x = mousePos[0]
        mouseDownNode.y = -mousePos[1]
        updateLayout();
    }
});




// MENU
var menuDiv = d3.select('#menuDiv');
ui.makeSlider(menuDiv, 'Link Opacity', SLIDER_WIDTH, SLIDER_HEIGHT, LINK_OPACITY, 0, 1, function (value: number) {
    // linkWeightScale.range([0,value])
    LINK_OPACITY = value;
    updateLinks();
    webgl.render();
})
ui.makeSlider(menuDiv, 'Node Size', SLIDER_WIDTH, SLIDER_HEIGHT, NODE_SIZE, .01, 3, function (value: number) {
    // linkWeightScale.range([0,value])
    NODE_SIZE = value;
    updateNodeSize();
    webgl.render();
})
ui.makeSlider(menuDiv, 'Edge Gap', SLIDER_WIDTH, SLIDER_HEIGHT, LINK_GAP, 0, 10, function (value: number) {
    LINK_GAP = value;
    updateLayout();
    webgl.render();
})
ui.makeSlider(menuDiv, 'Link Width', SLIDER_WIDTH, SLIDER_HEIGHT, LINK_WIDTH, 0, 10, function (value: number) {
    LINK_WIDTH = value;
    linkWeightScale.range([0, LINK_WIDTH]);
    // updateLayout();
    updateLinks();
    webgl.render();
})
makeDropdown(menuDiv, 'Labeling', ['Automatic', 'Hide All', 'Show All', 'Neighbors'], (selection: any) => {
    LABELING_STRATEGY = parseInt(selection);
    updateLabelVisibility();
    webgl.render();
})

function makeDropdown(d3parent: any, name: string, values: String[], callback: Function) {
    var s: any = d3parent.append('select')
        .attr('id', "selection-input_" + name)

    s.append('option')
        .html('Chose ' + name + ':')

    values.forEach((v: any, i: number) => {
        s.append('option').attr('value', i).html(v)
    })

    s.on('change', () => {
        console.log('name', name)
        var e = document.getElementById("selection-input_" + name) as HTMLSelectElement;
        callback(e.options[e.selectedIndex].value);
    })
}




// TIMELINE
var timeSvg: any = d3.select('#timelineDiv')
    .append('svg')
    .attr('width', width)
    .attr('height', TIMELINE_HEIGHT)

if (dgraph.times().size() > 1) {
    var timeSlider: timeslider.TimeSlider = new timeslider.TimeSlider(dgraph, width - 50);
    timeSlider.appendTo(timeSvg);
    messenger.addEventListener('timeRange', timeChangedHandler)
}




// WEBGL + VISUALIZATION
$('#visDiv').append('<svg id="visSvg"><foreignObject id="visCanvasFO"></foreignObject></svg>');
d3.select('#visCanvasFO')
    .attr('x', 0)
    .attr('y', 0)

var webgl = glutils.initWebGL('visCanvasFO', width, height);
// webgl.enableZoom();
webgl.camera.position.x = width / 2;
webgl.camera.position.y = -height / 2;
webgl.camera.position.z = 1000;

webgl.interactor.addEventListener('lassoEnd', lassoEndHandler)
webgl.interactor.addEventListener('lassoMove', lassoMoveHandler)


var visualNodes: any;
var nodeLabels: any;
var nodeLabelBackgrounds: any;
var visualLinks: any;
var layout: any;

// layout = d3.layout.force()
// set nod width
for (var i = 0; i < nodes.length; i++) {
    (nodes[i] as any)['width'] = getNodeRadius(nodes[i]) * 2;
    (nodes[i] as any)['height'] = getNodeRadius(nodes[i]) * 2;
}

/* d3 v3 */
layout = d3.layout.force()
    // layout = cola.d3adaptor()
    .linkDistance(30)
    .size([width, height])
    .nodes(nodes)
    .links(links)
    .on('end', () => {
        updateNodes();
        updateLinks();
        updateLayout();
        // package layout coordinates
        var coords = []
        for (var i = 0; i < nodes.length; i++) {
            coords.push({ x: (nodes[i] as any).x, y: (nodes[i] as any).y })
        }
        messenger.sendMessage('layout', { coords: coords })
    })
    .start()

/* d3 v4 */
/*
    layout = d3.forceSimulation()
    .force("link", d3.forceLink().distance(30).strength(0.1))
    .nodes(nodes)
    .force("link", d3.forceLink().links(links))
        .on('end', () => {
            updateNodes();
            updateLinks();
            updateLayout();
            // package layout coordinates
            var coords: any = []
            for (var i = 0; i < nodes.length; i++) {
                coords.push({ x: (nodes[i] as any).x, y: (nodes[i] as any).y })
            }
            messenger.sendMessage('layout', { coords: coords })
        })
*/

init();
function init() {
    // CREATE NODES:
    // node circles
    visualNodes = glutils.selectAll()
        .data(nodes)
        .append('circle')
        .attr('r', (n: dynamicgraph.Node) => getNodeRadius(n))
        .style('fill', COLOR_DEFAULT_NODE)
        .on('mouseover', mouseOverNode)
        .on('mouseout', mouseOutNode)
        .on('mousedown', mouseDownOnNode)
        .on('mouseup', mouseUpNode)
        .on('click', (d: any) => {
            var selections: any = d.getSelections();
            var currentSelection: any = dgraph.getCurrentSelection();
            for (var j = 0; j < selections.length; j++) {
                if (selections[j] == currentSelection) {
                    messenger.selection('remove', <utils.ElementCompound>{ nodes: [d] });
                    return;
                }
            }
            messenger.selection('add', <utils.ElementCompound>{ nodes: [d] });
        })



    // node labels 
    nodeLabels = glutils.selectAll()
        .data(nodes)
        .append('text')
        .attr('z', 2)
        .text((d: any) => d.label())
        .style('font-size', 12)
        .style('opacity', 0)


    // node label backgrounds
    nodeLabelBackgrounds = glutils.selectAll()
        .data(nodes)
        .append('rect')
        .attr('x', (d: any) => d.x)
        .attr('y', (d: any) => d.y)
        .attr('z', 1)
        .attr('width', (d: any, i: any) => getLabelWidth(d))
        .attr('height', (d: any, i: any) => getLabelHeight(d))
        .style('fill', '#eeeee6')
        .style('opacity', 0)



    // CREATE LINKS
    calculateCurvedLinks();
    visualLinks = glutils.selectAll()
        .data(links)
        .append('path')
        .attr('d', (d: any) => d.path)
        .style('opacity', LINK_OPACITY)
        .on('mouseover', (d: any, i: any) => {
            messenger.highlight('set', <utils.ElementCompound>{ links: [d] })
        })
        .on('mouseout', (d: any) => {
            messenger.highlight('reset')
        })
        .on('click', (d: any) => {
            var selections: any = d.getSelections();
            var currentSelection: any = dgraph.getCurrentSelection();
            for (var j = 0; j < selections.length; j++) {
                if (selections[j] == currentSelection) {
                    messenger.selection('remove', <utils.ElementCompound>{ links: [d] });
                    return;
                }
            }
            messenger.selection('add', <utils.ElementCompound>{ links: [d] });
        })



    // updateLinks();
    // updateNodes();

    // updateLayout();
}

function updateLayout() {

    // update node positions
    visualNodes
        .attr('x', (d: any, i: any) => d.x)
        .attr('y', (d: any, i: any) => -d.y)

    nodeLabels
        .attr('x', (d: any, i: any) => d.x)
        .attr('y', (d: any, i: any) => -d.y)

    nodeLabelBackgrounds
        .attr('x', (d: any, i: any) => d.x - getLabelWidth(d) / 2)
        .attr('y', (d: any, i: any) => -d.y + getLabelHeight(d) / 2)

    // dgraph.links().forEach((d)=>{
    //     console.log('d.source', d.source.x, d.source.y)
    //     console.log('d.target', d.target.x, d.target.y)
    // })


    // update link positions
    calculateCurvedLinks();
    visualLinks
        .attr('d', (d: any) => d.path)


    // update nodelabel visibility after layout update.
    updateLabelVisibility();

    webgl.render();

}
function getLabelWidth(n: any) {
    return n.label().length * 8.5 + 10
}
function getLabelHeight(n: any) {
    return 18;
}
function getNodeRadius(n: dynamicgraph.Node) {
    return Math.sqrt(n.links().length) * NODE_SIZE + 1;
}


function updateLabelVisibility() {
    hiddenLabels = [];
    if (LABELING_STRATEGY == 0) { // automatic
        var n1: any, n2: any;
        for (var i = 0; i < nodesOrderedByDegree.length; i++) {
            n1 = nodesOrderedByDegree[i];
            if (hiddenLabels.indexOf(n1) > -1)
                continue;
            for (var j = i + 1; j < nodesOrderedByDegree.length; j++) {
                n2 = nodesOrderedByDegree[j];
                if (hiddenLabels.indexOf(n2) > -1)
                    continue;
                if (areNodeLabelsOverlapping(n1, n2)) {
                    hiddenLabels.push(n2)
                } else if (isHidingNode(n1, n2)) {
                    hiddenLabels.push(n1)
                    break;
                }
            }
        }
    } else if (LABELING_STRATEGY == 1) { // hide all
        hiddenLabels = nodes.slice(0);
    } else if (LABELING_STRATEGY == 2) { // show all
        hiddenLabels = [];
    } else if (LABELING_STRATEGY == 3) { // neighbors of highligted nodes
        hiddenLabels = nodes.slice(0);
    }

    // render;
    nodeLabels.style('opacity', (n: any) => hiddenLabels.indexOf(n) > -1 ? 0 : 1)
    nodeLabelBackgrounds.style('opacity', (n: any) => hiddenLabels.indexOf(n) > -1 ? 0 : LABELBACKGROUND_OPACITY)
}


function areNodeLabelsOverlapping(n1: any, n2: any) {
    var n1e: any = n1.x + getLabelWidth(n1) / 2 + LABELDISTANCE;
    var n2e: any = n2.x + getLabelWidth(n2) / 2 + LABELDISTANCE;
    var n1w: any = n1.x - getLabelWidth(n1) / 2 - LABELDISTANCE;
    var n2w: any = n2.x - getLabelWidth(n2) / 2 - LABELDISTANCE;
    var n1n: any = n1.y - getLabelHeight(n1) / 2 - LABELDISTANCE;
    var n2n: any = n2.y - getLabelHeight(n2) / 2 - LABELDISTANCE;
    var n1s: any = n1.y + getLabelHeight(n1) / 2 + LABELDISTANCE;
    var n2s: any = n2.y + getLabelHeight(n2) / 2 + LABELDISTANCE;

    return (n1e > n2w && n1w < n2e && n1s > n2n && n1n < n2s)
        || (n1e > n2w && n1w < n2e && n1n < n2s && n1s > n2n)
        || (n1w < n2e && n1s > n2n && n1s > n2n && n1n < n2s)
        || (n1w < n2e && n1n < n2s && n1n < n2s && n1s > n2n)
}

function isHidingNode(n1: any, n2: any) {
    var n1e: any = n1.x + getLabelWidth(n1) / 2 + LABELDISTANCE;
    var n1w: any = n1.x - getLabelWidth(n1) / 2 - LABELDISTANCE;
    var n1n: any = n1.y - getLabelHeight(n1) / 2 - LABELDISTANCE;
    var n1s: any = n1.y + getLabelHeight(n1) / 2 + LABELDISTANCE;
    return n1w < n2.x && n1e > n2.x && n1n > n2.y && n1s < n2.y;
}


/////////////////////
//// INTERACTION ////
/////////////////////

function mouseOverNode(n: any) {
    var newElementCompound: utils.ElementCompound = new utils.ElementCompound();
    newElementCompound.nodes = [n]
    messenger.highlight('set', newElementCompound)
}
function mouseOutNode(n: any) {
    messenger.highlight('reset')
}
function mouseDownOnNode(n: any) {
    mouseDownNode = n;
    webgl.enablePanning(false)
}
function mouseUpNode(n: any) {
    mouseDownNode = undefined;
    webgl.enablePanning(true)
}

window.addEventListener("mousewheel", mouseWheel, false);
var globalZoom: number = 1;
function mouseWheel(event: any) {

    event.preventDefault();
    var mouse: any = glutils.mouseToWorldCoordinates(event.clientX, event.clientY)
    globalZoom = 1 + event.wheelDelta / 1000;

    // updatelayout
    var d: any, n: any;
    for (var i = 0; i < nodes.length; i++) {
        n = nodes[i]
        n.x = mouse[0] + (n.x - mouse[0]) * globalZoom;
        n.y = -mouse[1] + (n.y + mouse[1]) * globalZoom;
    }
    updateLayout()
}


/////////////////
//// UPDATES ////
/////////////////

function timeChangedHandler(m: messenger.TimeRangeMessage) {

    for (var i = 0; i < times.length; i++) {
        if (times[i].unixTime() > m.startUnix) {
            time_start = times[i - 1];
            break;
        }
    }
    for (i; i < times.length; i++) {
        if (times[i].unixTime() > m.endUnix) {
            time_end = times[i - 1];
            break;
        }
    }
    if (time_end == undefined) {
        time_end = times[times.length - 1]
    }

    console.log('start-end', time_start, time_end)


    timeSlider.set(m.startUnix, m.endUnix);
    updateLinks();
    updateNodes();
    webgl.render()
}


function updateEvent(m: messenger.Message) {
    updateLinks();
    updateNodes();
    webgl.render();
}

function updateNodeSize() {
    visualNodes
        .attr('r', (n: any) => getNodeRadius(n))


}

function updateNodes() {
    visualNodes
        .style('fill', (d: any) => {
            var color: any;
            if (d.isHighlighted()) {
                color = COLOR_HIGHLIGHT;
            } else {
                color = utils.getPriorityColor(d);
            }
            if (!color)
                color = COLOR_DEFAULT_NODE;
            return color;
        })
        .style('opacity', (d: any) => {
            var visible: any = d.isVisible();
            if (!visible)
                return 0;
            else
                return 1;
        })



    nodeLabels
        .style('opacity', (e: any) => e.isHighlighted()
            || e.links().highlighted().length > 0
            || hiddenLabels.indexOf(e) == -1
            || (LABELING_STRATEGY == 3 && e.neighbors().highlighted().length > 0)
            ? 1 : 0)


    // .attr('z', (e) => e.isHighlighted() 
    //                     ||  e.links().highlighted().length > 0
    //                     ||  hiddenLabels.indexOf(e)==-1 
    //                     ||  (labelingStrategy == 3 && e.neighbors().highlighted().length > 0)                                  
    //                     ? 11 : 1)          

    nodeLabelBackgrounds
        .style('opacity', (e: any) => e.isHighlighted()
            || e.links().highlighted().length > 0
            || hiddenLabels.indexOf(e) == -1
            || (LABELING_STRATEGY == 3 && e.neighbors().highlighted().length > 0)
            ? LABELBACKGROUND_OPACITY : 0)
        // .attr('z', (e) => e.isHighlighted() 
        //                     ||  e.links().highlighted().length > 0
        //                     ||  hiddenLabels.indexOf(e)==-1 
        //                     ||  (labelingStrategy == 3 && e.neighbors().highlighted().length > 0)                                  
        //                     ? 10 : 1)          
        .style('stroke', (d: any) => {
            var color: any;
            if (d.isHighlighted()) {
                color = COLOR_HIGHLIGHT;
            } else {
                color = utils.getPriorityColor(d);
            }
            if (!color)
                color = COLOR_DEFAULT_NODE;
            return color;
        })


}

function updateLinks() {
    visualLinks
        .style('stroke', function (d: any) {
            var color = utils.getPriorityColor(d);
            if (!color)
                color = COLOR_DEFAULT_LINK;
            return color;
        })
        .style('opacity', (d: any) => {
            var visible: any = d.isVisible();
            if (!visible
                || !d.source.isVisible()
                || !d.target.isVisible())
                return 0;
            if (d.presentIn(time_start, time_end)) {
                return d.isHighlighted() || d.source.isHighlighted() || d.target.isHighlighted() ?
                    Math.min(1, LINK_OPACITY + .2) : LINK_OPACITY;
            } else {
                return 0;
            }
        })
        .style('stroke-width', function (d: any) {
            var w: any = linkWeightScale(d.weights(time_start, time_end).mean());
            return d.isHighlighted() ? w * 2 : w;
        })


}

function calculateCurvedLinks() {
    var path: any, dir: any, offset: any, offset2: any, multiLink: dynamicgraph.NodePair | undefined;
    var links: dynamicgraph.Link[];
    for (var i = 0; i < dgraph.nodePairs().length; i++) {
        multiLink = dgraph.nodePair(i);
        if (multiLink) {
            if (multiLink.links().length < 2) {
                (multiLink.links().toArray()[0] as any)['path'] = [
                    { x: (multiLink.source as any).x, y: -(multiLink.source as any).y },
                    { x: (multiLink.source as any).x, y: -(multiLink.source as any).y },
                    { x: (multiLink.target as any).x, y: -(multiLink.target as any).y },
                    { x: (multiLink.target as any).x, y: -(multiLink.target as any).y }]
            } else {
                links = multiLink.links().toArray();
                // Draw self-links as back-link
                if (multiLink.source == multiLink.target) {
                    var minGap: any = getNodeRadius(multiLink.source) / 2 + 4;
                    for (var j = 0; j < links.length; j++) {
                        (links[j] as any)['path'] = [
                            { x: (multiLink.source as any).x, y: -(multiLink.source as any).y },
                            { x: (multiLink.source as any).x, y: -(multiLink.source as any).y + minGap + (i * LINK_GAP) },
                            { x: (multiLink.source as any).x + minGap + (i * LINK_GAP), y: -(multiLink.source as any).y + minGap + (i * LINK_GAP) },
                            { x: (multiLink.source as any).x + minGap + (i * LINK_GAP), y: -(multiLink.source as any).y },
                            { x: (multiLink.source as any).x, y: -(multiLink.source as any).y },
                        ]
                    }
                    // non-self links
                } else {

                    dir = {
                        x: (multiLink.target as any).x - (multiLink.source as any).x,
                        y: (multiLink.target as any).y - (multiLink.source as any).y
                    }
                    // normalize
                    offset = stretchVector([-dir.y, dir.x], LINK_GAP)
                    offset2 = stretchVector([dir.x, dir.y], LINK_GAP)

                    // calculate paths
                    for (var j = 0; j < links.length; j++) {
                        (links[j] as any)['path'] = [
                            { x: (multiLink.source as any).x, y: -(multiLink.source as any).y },
                            {
                                x: (multiLink.source as any).x + offset2[0] + (j - links.length / 2 + .5) * offset[0],
                                y: -((multiLink.source as any).y + offset2[1] + (j - links.length / 2 + .5) * offset[1])
                            },
                            {
                                x: (multiLink.target as any).x - offset2[0] + (j - links.length / 2 + .5) * offset[0],
                                y: -((multiLink.target as any).y - offset2[1] + (j - links.length / 2 + .5) * offset[1])
                            },
                            { x: (multiLink.target as any).x, y: -(multiLink.target as any).y }]
                    }

                }

            }
        }
    }
}
function stretchVector(vec: any, finalLength: any) {
    var len: number = 0
    for (var i = 0; i < vec.length; i++) {
        len += Math.pow(vec[i], 2)
    }
    len = Math.sqrt(len)
    for (var i = 0; i < vec.length; i++) {
        vec[i] = vec[i] / len * finalLength
    }

    return vec
}

var visualLassoPoints: glutils.WebGLElementQuery;
function lassoMoveHandler(lassoPoints: number[][]) {

    if (visualLassoPoints != undefined)
        visualLassoPoints.removeAll();

    visualLassoPoints = glutils.selectAll()
        // .data([lassoPoints[lassoPoints.length-1]])
        .data(lassoPoints)
        .append('circle')
        .attr('r', 1)
        .style('fill', '#ff9999')
        .attr('x', (d: any) => d[0])
        .attr('y', (d: any) => d[1])



    webgl.render();
}


function lassoEndHandler(lassoPoints: number[][]) {

    if (visualLassoPoints != undefined)
        visualLassoPoints.removeAll();


    var selectedNodes: any[] = []
    for (var i = 0; i < nodes.length; i++) {
        if (utils.isPointInPolyArray(lassoPoints, [(nodes[i] as any).x, -(nodes[i] as any).y]))
            selectedNodes.push(nodes[i])
    }
    console.log('Selected nodes:', selectedNodes.length)
    // get links in selection
    var selectedLinks: any[] = []
    var incidentLinks: any[] = [];
    for (var i = 0; i < selectedNodes.length; i++) {
        for (var j = i + 1; j < selectedNodes.length; j++) {
            // incidentLinks = dgraph.linksBetween(selectedNodes[i], selectedNodes[j]).presentIn(time_start,time_end).toArray() 
            incidentLinks = dgraph.linksBetween(selectedNodes[i], selectedNodes[j]).toArray()
            selectedLinks = selectedLinks.concat(incidentLinks);
        }
    }
    console.log('Selected links:', selectedLinks.length)
    if (selectedNodes.length > 0) {
        messenger.selection('set', <utils.ElementCompound>{ nodes: selectedNodes, links: selectedLinks })
    }
}

function exportPNG() {
    utils.exportPNG(webgl.canvas, 'node-link');
}


