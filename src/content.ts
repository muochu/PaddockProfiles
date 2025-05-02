import type { DriverStats } from './types';

// --- Data Loading ---
// We need to fetch the JSON data from the extension's context
let driverData: Record<string, DriverStats> | null = null;
let driverNames: string[] = [];

async function loadDriverData() {
  try {
    const dataUrl = chrome.runtime.getURL('public/driver_data.json');
    const response = await fetch(dataUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch driver data: ${response.statusText}`);
    }
    driverData = await response.json() as Record<string, DriverStats>;
    driverNames = Object.keys(driverData);
    console.log('F1 Driver Context: Data loaded successfully.');
    scanAndHighlight(); // Start scanning after data is loaded
  } catch (error) {
    console.error('F1 Driver Context: Error loading driver data:', error);
  }
}

// --- Constants ---
const HIGHLIGHT_CLASS = 'f1-driver-highlight';
const TOOLTIP_ID = 'f1-driver-tooltip';

// --- DOM Manipulation & Highlighting ---

function scanAndHighlight() {
  if (!driverData || driverNames.length === 0) {
    console.log('F1 Driver Context: No driver data loaded, skipping scan.');
    return;
  }

  const startTime = performance.now();
  console.log('F1 Driver Context: Starting scan...');

  // Use TreeWalker for efficient DOM traversal
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node: Node) => {
        // Skip script/style/textarea/input nodes and nodes already inside highlights
        if (
          node.parentElement?.closest('script, style, textarea, input, .' + HIGHLIGHT_CLASS) ||
          !node.textContent?.trim() // Ignore nodes with only whitespace
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  let currentNode: Node | null;
  const nodesToProcess: Text[] = [];
  while ((currentNode = walker.nextNode())) {
    if (currentNode instanceof Text) {
      nodesToProcess.push(currentNode);
    }
  }

  // Process nodes after traversal to avoid modifying the DOM while iterating
  nodesToProcess.forEach(node => processTextNode(node));

  const endTime = performance.now();
  console.log(`F1 Driver Context: Scan completed in ${endTime - startTime}ms.`);

  // Add event listeners to newly highlighted spans
  attachEventListeners();
}

function processTextNode(node: Text) {
  if (!driverData) return;

  let nodeContent = node.textContent || '';
  let lastIndex = 0;
  const fragment = document.createDocumentFragment();

  // Simple case-insensitive search for now
  // TODO: Improve matching (e.g., boundaries, Aho-Corasick for many names)
  driverNames.forEach(name => {
    const nameLower = name.toLowerCase();
    let matchIndex = nodeContent.toLowerCase().indexOf(nameLower, lastIndex);

    while (matchIndex !== -1) {
      // Check word boundaries (simple version)
      const before = matchIndex === 0 || /\W/.test(nodeContent[matchIndex - 1] || '');
      const after = matchIndex + name.length === nodeContent.length || /\W/.test(nodeContent[matchIndex + name.length] || '');

      if (before && after) {
          // Add text before the match
          if (matchIndex > lastIndex) {
            fragment.appendChild(document.createTextNode(nodeContent.substring(lastIndex, matchIndex)));
          }

          // Create and add the highlighted span
          const span = document.createElement('span');
          span.className = HIGHLIGHT_CLASS;
          span.textContent = nodeContent.substring(matchIndex, matchIndex + name.length);
          span.dataset.driverName = name; // Store original case name
          fragment.appendChild(span);

          lastIndex = matchIndex + name.length;
      } else {
        // False positive (part of another word), continue search after this potential match
        matchIndex = nodeContent.toLowerCase().indexOf(nameLower, matchIndex + 1);
        continue; // Skip to next potential match index
      }
      // Find next occurrence of the *same* name after the current one
      matchIndex = nodeContent.toLowerCase().indexOf(nameLower, lastIndex);
    }
  });

  // If any replacements were made
  if (lastIndex > 0) {
    // Add any remaining text after the last match
    if (lastIndex < nodeContent.length) {
      fragment.appendChild(document.createTextNode(nodeContent.substring(lastIndex)));
    }
    // Replace the original text node with the fragment containing highlights
    node.parentNode?.replaceChild(fragment, node);
  }
}

// --- Tooltip Logic ---

let tooltipElement: HTMLDivElement | null = null;

function createTooltip() {
  if (document.getElementById(TOOLTIP_ID)) return;

  tooltipElement = document.createElement('div');
  tooltipElement.id = TOOLTIP_ID;
  tooltipElement.style.position = 'absolute';
  tooltipElement.style.border = '1px solid #ccc';
  tooltipElement.style.backgroundColor = '#f9f9f9';
  tooltipElement.style.padding = '8px';
  tooltipElement.style.borderRadius = '4px';
  tooltipElement.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
  tooltipElement.style.fontSize = '12px';
  tooltipElement.style.fontFamily = 'sans-serif';
  tooltipElement.style.zIndex = '10000'; // High z-index
  tooltipElement.style.pointerEvents = 'none'; // Don't interfere with mouse
  tooltipElement.style.display = 'none'; // Hidden initially
  document.body.appendChild(tooltipElement);
}

function showTooltip(event: MouseEvent) {
  if (!tooltipElement || !driverData) return;

  const target = event.target as HTMLElement;
  const driverName = target.dataset.driverName;

  if (!driverName || !driverData[driverName]) return;

  const stats = driverData[driverName];
  tooltipElement.innerHTML = `
        <strong>${driverName}</strong><br>
        Team: ${stats.team}<br>
        Wins: ${stats.wins}<br>
        Championships: ${stats.championships}<br>
        Career: ${stats.career_span}
    `;

  // Position tooltip near the mouse cursor
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  let top = event.clientY + scrollY + 15; // Below cursor
  let left = event.clientX + scrollX + 10; // Right of cursor

  tooltipElement.style.display = 'block'; // Show it first to calculate dimensions

  // Adjust if tooltip goes off-screen
  const tooltipRect = tooltipElement.getBoundingClientRect();
  const bodyRect = document.body.getBoundingClientRect();

  if (left + tooltipRect.width > bodyRect.right + scrollX) {
    left = event.clientX + scrollX - tooltipRect.width - 10; // Move left
  }
  if (top + tooltipRect.height > window.innerHeight + scrollY) {
    top = event.clientY + scrollY - tooltipRect.height - 15; // Move above
  }

  tooltipElement.style.left = `${Math.max(0, left)}px`;
  tooltipElement.style.top = `${Math.max(0, top)}px`;
}

function hideTooltip() {
  if (tooltipElement) {
    tooltipElement.style.display = 'none';
  }
}

// --- Event Listeners ---

function attachEventListeners() {
  const highlightedElements = document.querySelectorAll<HTMLElement>(`.${HIGHLIGHT_CLASS}`);

  highlightedElements.forEach(el => {
    // Remove old listeners first to prevent duplicates if scan runs multiple times
    el.removeEventListener('mouseenter', showTooltip);
    el.removeEventListener('mouseleave', hideTooltip);
    // Add new listeners
    el.addEventListener('mouseenter', showTooltip);
    el.addEventListener('mouseleave', hideTooltip);
  });
}

// --- Initialization ---

createTooltip(); // Create the tooltip element once
loadDriverData(); // Load data and start the process

// Optional: Re-run scan on DOM changes (for dynamic content - V2 feature)
// const observer = new MutationObserver(mutations => {
//   // Basic check: re-scan if nodes are added/removed
//   if (mutations.some(m => m.addedNodes.length > 0 || m.removedNodes.length > 0)) {
//     console.log('F1 Driver Context: DOM changed, rescanning...');
//     scanAndHighlight();
//   }
// });
// observer.observe(document.body, { childList: true, subtree: true });

console.log('F1 Driver Context: Content script loaded.');
