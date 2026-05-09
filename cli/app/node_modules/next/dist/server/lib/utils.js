"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    RESTART_EXIT_CODE: null,
    formatDebugAddress: null,
    formatNodeOptions: null,
    getFormattedNodeOptionsWithoutInspect: null,
    getMaxOldSpaceSize: null,
    getNodeDebugType: null,
    getNodeOptionsArgs: null,
    getParsedDebugAddress: null,
    getParsedNodeOptions: null,
    getParsedNodeOptionsWithoutInspect: null,
    parseValidPositiveInteger: null,
    printAndExit: null,
    tokenizeArgs: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    RESTART_EXIT_CODE: function() {
        return RESTART_EXIT_CODE;
    },
    formatDebugAddress: function() {
        return formatDebugAddress;
    },
    formatNodeOptions: function() {
        return formatNodeOptions;
    },
    getFormattedNodeOptionsWithoutInspect: function() {
        return getFormattedNodeOptionsWithoutInspect;
    },
    getMaxOldSpaceSize: function() {
        return getMaxOldSpaceSize;
    },
    getNodeDebugType: function() {
        return getNodeDebugType;
    },
    getNodeOptionsArgs: function() {
        return getNodeOptionsArgs;
    },
    getParsedDebugAddress: function() {
        return getParsedDebugAddress;
    },
    getParsedNodeOptions: function() {
        return getParsedNodeOptions;
    },
    getParsedNodeOptionsWithoutInspect: function() {
        return getParsedNodeOptionsWithoutInspect;
    },
    parseValidPositiveInteger: function() {
        return parseValidPositiveInteger;
    },
    printAndExit: function() {
        return printAndExit;
    },
    tokenizeArgs: function() {
        return tokenizeArgs;
    }
});
const _nodeutil = require("node:util");
const _commander = require("next/dist/compiled/commander");
function printAndExit(message, code = 1) {
    if (code === 0) {
        console.log(message);
    } else {
        console.error(message);
    }
    return process.exit(code);
}
const parseNodeArgs = (args)=>{
    const { values, tokens } = (0, _nodeutil.parseArgs)({
        args,
        strict: false,
        tokens: true
    });
    // For the `NODE_OPTIONS`, we support arguments with values without the `=`
    // sign. We need to parse them manually.
    let orphan = null;
    for(let i = 0; i < tokens.length; i++){
        const token = tokens[i];
        if (token.kind === 'option-terminator') {
            break;
        }
        // When we encounter an option, if it's value is undefined, we should check
        // to see if the following tokens are positional parameters. If they are,
        // then the option is orphaned, and we can assign it.
        if (token.kind === 'option') {
            orphan = typeof token.value === 'undefined' ? token : null;
            continue;
        }
        // If the token isn't a positional one, then we can't assign it to the found
        // orphaned option.
        if (token.kind !== 'positional') {
            orphan = null;
            continue;
        }
        // If we don't have an orphan, then we can skip this token.
        if (!orphan) {
            continue;
        }
        // If the token is a positional one, and it has a value, so add it to the
        // values object. If it already exists, append it with a space.
        if (orphan.name in values && typeof values[orphan.name] === 'string') {
            values[orphan.name] += ` ${token.value}`;
        } else {
            values[orphan.name] = token.value;
        }
    }
    return values;
};
const tokenizeArgs = (input)=>{
    let args = [];
    let isInString = false;
    let willStartNewArg = true;
    for(let i = 0; i < input.length; i++){
        let char = input[i];
        // Skip any escaped characters in strings.
        if (char === '\\' && isInString) {
            // Ensure we don't have an escape character at the end.
            if (input.length === i + 1) {
                throw Object.defineProperty(new Error('Invalid escape character at the end.'), "__NEXT_ERROR_CODE", {
                    value: "E168",
                    enumerable: false,
                    configurable: true
                });
            }
            // Skip the next character.
            char = input[++i];
        } else if (char === ' ' && !isInString) {
            willStartNewArg = true;
            continue;
        } else if (char === '"') {
            isInString = !isInString;
            continue;
        }
        // If we're starting a new argument, we should add it to the array.
        if (willStartNewArg) {
            args.push(char);
            willStartNewArg = false;
        } else {
            args[args.length - 1] += char;
        }
    }
    if (isInString) {
        throw Object.defineProperty(new Error('Unterminated string'), "__NEXT_ERROR_CODE", {
            value: "E208",
            enumerable: false,
            configurable: true
        });
    }
    return args;
};
const getNodeOptionsArgs = ()=>{
    if (!process.env.NODE_OPTIONS) return [];
    return tokenizeArgs(process.env.NODE_OPTIONS);
};
const formatDebugAddress = ({ host, port })=>{
    if (host) return `${host}:${port}`;
    return `${port}`;
};
const getParsedDebugAddress = (address)=>{
    if (!address || typeof address !== 'string') {
        return {
            host: undefined,
            port: 9229
        };
    }
    // The address is in the form of `[host:]port`. Let's parse the address.
    if (address.includes(':')) {
        const [host, port] = address.split(':');
        return {
            host,
            port: parseInt(port, 10)
        };
    }
    return {
        host: undefined,
        port: parseInt(address, 10)
    };
};
/**
 * Node.js CLI flags that are not allowed in NODE_OPTIONS and must be
 * passed as direct CLI arguments via execArgv.
 * This set is the difference between all Node.js CLI flags and the ones **not**
 * allowed in NODE_OPTIONS, as listed in the Node.js documentation:
 * https://nodejs.org/api/cli.html#node_optionsoptions
 *
 * It is not exhaustive since not all options make sense for Next.js (e.g. --test)
 */ const EXEC_ARGV_ONLY_OPTIONS = new Set([
    'experimental-network-inspection',
    'experimental-storage-inspection',
    'experimental-worker-inspection',
    'experimental-inspector-network-resource'
]);
function formatArg(key, value) {
    if (value === true) {
        return `--${key}`;
    }
    if (value) {
        return `--${key}=${// Values with spaces need to be quoted. We use JSON.stringify to
        // also escape any nested quotes.
        value.includes(' ') && !value.startsWith('"') ? JSON.stringify(value) : value}`;
    }
    return null;
}
function formatNodeOptions(args) {
    const nodeOptionsParts = [];
    const execArgv = [];
    for (const [key, value] of Object.entries(args)){
        const formatted = formatArg(key, value);
        if (formatted === null) continue;
        if (EXEC_ARGV_ONLY_OPTIONS.has(key)) {
            execArgv.push(formatted);
        } else {
            nodeOptionsParts.push(formatted);
        }
    }
    return {
        nodeOptions: nodeOptionsParts.join(' '),
        execArgv
    };
}
function getParsedNodeOptions() {
    const args = [
        ...process.execArgv,
        ...getNodeOptionsArgs()
    ];
    if (args.length === 0) return {};
    return parseNodeArgs(args);
}
function getParsedNodeOptionsWithoutInspect() {
    const args = getNodeOptionsArgs();
    if (args.length === 0) return {};
    const parsed = parseNodeArgs(args);
    // Remove inspect options.
    delete parsed.inspect;
    delete parsed['inspect-brk'];
    delete parsed['inspect_brk'];
    return parsed;
}
function getFormattedNodeOptionsWithoutInspect() {
    const args = getParsedNodeOptionsWithoutInspect();
    if (Object.keys(args).length === 0) return '';
    return formatNodeOptions(args).nodeOptions;
}
function parseValidPositiveInteger(value) {
    const parsedValue = parseInt(value, 10);
    if (isNaN(parsedValue) || !isFinite(parsedValue) || parsedValue < 0) {
        throw new _commander.InvalidArgumentError(`'${value}' is not a non-negative number.`);
    }
    return parsedValue;
}
const RESTART_EXIT_CODE = 77;
function getNodeDebugType(nodeOptions) {
    if (nodeOptions.inspect) {
        return 'inspect';
    }
    if (nodeOptions['inspect-brk'] || nodeOptions['inspect_brk']) {
        return 'inspect-brk';
    }
}
function getMaxOldSpaceSize() {
    const args = getNodeOptionsArgs();
    if (args.length === 0) return;
    const parsed = parseNodeArgs(args);
    const size = parsed['max-old-space-size'] || parsed['max_old_space_size'];
    if (!size || typeof size !== 'string') return;
    return parseInt(size, 10);
}

//# sourceMappingURL=utils.js.map