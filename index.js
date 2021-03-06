module.exports = function(options) {
	'use strict';

	var requirejs, Vinyl, path, through, cache, isWindows, dukeWindowsDriveRegExp, windowsDriveRegExp, op, hasOwn, hasProp;

	isWindows = process.platform === 'win32';
	windowsDriveRegExp = /^[a-zA-Z]\:\\/;
	dukeWindowsDriveRegExp = /^[a-zA-Z]\:\//;
	requirejs = require("requirejs");
	through = require("through2");
	Vinyl = require("vinyl");
	path = require("path");
	cache = {};
	op = Object.prototype;
	hasOwn = op.hasOwnProperty;

	function hasProp(obj, prop) {
		return hasOwn.call(obj, prop);
	}

	function frontSlash(sPath) {
		if (isWindows && dukeWindowsDriveRegExp.test(sPath)) {
			sPath = sPath.replace(/\//g, '\\');
		}
		return sPath;
	}

	function exists(sPath) {
		if (sPath === frontSlash(path.normalize(options.baseUrl))) {
			return true;
		}

		return hasProp(cache, frontSlash(sPath));
	}

	function mkDir(dir) {
		if (!exists(dir) && (!isWindows || !windowsDriveRegExp.test(dir))) {
			fs.mkdirSync(dir, 511);
		}
	}

	function mkFullDir(dir) {
		var parts = dir.split('/'),
			currDir = '',
			first = true;

		parts.forEach(function(part) {
			//First part may be empty string if path starts with a slash.
			currDir += part + '/';
			first = false;

			if (part) {
				mkDir(currDir);
			}
		});
	}

	function start(file, encoding, callback) {
		var resovledPath = path.resolve(options.baseUrl, file.relative);
		var normalizedPath = path.normalize(resovledPath);
		var frontSlashedPath = frontSlash(normalizedPath);
		file.path = frontSlashedPath;
		cache[frontSlashedPath] = file;
		callback();
	}

	function end(callback) {
		requirejs.define("node/file", ["fs", "path", "prim"], function(fs, path, prim) {
			return {
				backSlashRegExp: /\\/g,
				exclusionRegExp: /^\./,
				getLineSeparator: function() {
					return '/';
				},

				exists: function(fileName) {
					return exists(fileName);
				},

				parent: function(fileName) {
					var parts = fileName.split('/');
					parts.pop();
					return parts.join('/');
				},

				/**
				 * Gets the absolute file path as a string, normalized
				 * to using front slashes for path separators.
				 * @param {String} fileName
				 */
				absPath: function(fileName) {
					return frontSlash(path.normalize(frontSlash(fs.realpathSync(fileName))));
				},

				normalize: function(fileName) {
					return frontSlash(path.normalize(fileName));
				},

				isFile: function(path) {
					// return fs.statSync(path).isFile();
					return cache[path].stat.isFile();
				},

				isDirectory: function(path) {
					return cache[path].stat.isDirectory();
				},

				getFilteredFileList: function( /*String*/ startDir, /*RegExp*/ regExpFilters, /*boolean?*/ makeUnixPaths) {
					//summary: Recurses startDir and finds matches to the files that match regExpFilters.include
					//and do not match regExpFilters.exclude. Or just one regexp can be passed in for regExpFilters,
					//and it will be treated as the "include" case.
					//Ignores files/directories that start with a period (.) unless exclusionRegExp
					//is set to another value.
					var files = [],
						regExpInclude, regExpExclude,
						ok, name;

					regExpInclude = regExpFilters.include || regExpFilters;
					regExpExclude = regExpFilters.exclude || null;

					for (name in cache) {
						if (cache[name].stat.isFile()) {
							ok = true;

							if (regExpInclude) {
								ok = name.match(regExpInclude);
							}

							if (ok && regExpExclude) {
								ok = !name.match(regExpExclude);
							}

							if (ok && (!this.exclusionRegExp ||
									!this.exclusionRegExp.test(name))) {
								files.push(name);
							}
						}
					}

					return files; //Array
				},

				copyDir: function( /*String*/ srcDir, /*String*/ destDir, /*RegExp?*/ regExpFilter, /*boolean?*/ onlyCopyNew) {
					//summary: copies files from srcDir to destDir using the regExpFilter to determine if the
					//file should be copied. Returns a list file name strings of the destinations that were copied.
					regExpFilter = regExpFilter || /\w/;

					//Normalize th directory names, but keep front slashes.
					//path module on windows now returns backslashed paths.
					srcDir = frontSlash(path.normalize(srcDir));
					destDir = frontSlash(path.normalize(destDir));

					var fileNames = this.getFilteredFileList(srcDir, regExpFilter, true),
						copiedFiles = [],
						i, srcFileName, destFileName;

					for (i = 0; i < fileNames.length; i++) {
						srcFileName = fileNames[i];
						destFileName = srcFileName.replace(srcDir, destDir);

						if (this.copyFile(srcFileName, destFileName, onlyCopyNew)) {
							copiedFiles.push(destFileName);
						}
					}


					return copiedFiles.length ? copiedFiles : null; //Array or null
				},

				copyFile: function( /*String*/ srcFileName, /*String*/ destFileName, /*boolean?*/ onlyCopyNew) {
					//summary: copies srcFileName to destFileName. If onlyCopyNew is set, it only copies the file if
					//srcFileName is newer than destFileName. Returns a boolean indicating if the copy occurred.
					// var parentDir;

					//logger.trace("Src filename: " + srcFileName);
					//logger.trace("Dest filename: " + destFileName);

					//If onlyCopyNew is true, then compare dates and only copy if the src is newer
					//than dest.
					if (onlyCopyNew) {
						if (this.exists(destFileName) && cache[destFileName].stat.mtime.getTime() >= cache[srcFileName].stat.mtime.getTime()) {
							return false; //Boolean
						}
					}

					// fs.writeFileSync(destFileName, fs.readFileSync(srcFileName, 'binary'), 'binary');
					if (this.exists(srcFileName)) {
						srcFileName = frontSlash(srcFileName);
						destFileName = frontSlash(destFileName);

						cache[destFileName] = cache[srcFileName].clone();
						cache[destFileName].path = destFileName;
						return true; //Boolean
					}
				},

				/**
				 * Renames a file. May fail if "to" already exists or is on another drive.
				 */
				renameFile: function(from, to) {
					from = frontSlash(from);
					to = frontSlash(to);
					if (this.exists(from)) {
						cache[to] = cache[from];
						cache[to].path = to;
						cache[from] = null;
						delete cache[from];
						return true;
					}
				},

				/**
				 * Reads a *text* file.
				 */
				readFile: function( /*String*/ path, /*String?*/ encoding) {
					path = frontSlash(path);
					if (encoding === 'utf-8') {
						encoding = 'utf8';
					}
					if (!encoding) {
						encoding = 'utf8';
					}

					var text = cache[path].contents + "";
					//Hmm, would not expect to get A BOM, but it seems to happen,
					//remove it just in case.
					if (text.indexOf('\uFEFF') === 0) {
						text = text.substring(1, text.length);
					}


					return text;
				},

				readFileAsync: function(path, encoding) {
					var d = prim();
					try {
						d.resolve(this.readFile(path, encoding));
					} catch (e) {
						d.reject(e);
					}
					return d.promise;
				},

				saveUtf8File: function( /*String*/ fileName, /*String*/ fileContents) {
					//summary: saves a *text* file using UTF-8 encoding.
					this.saveFile(fileName, fileContents, "utf8");
				},

				saveFile: function( /*String*/ fileName, /*String*/ fileContents, /*String?*/ encoding) {
					var targetFileName, file;
					//summary: saves a *text* file.
					if (encoding === 'utf-8') {
						encoding = 'utf8';
					}
					if (!encoding) {
						encoding = 'utf8';
					}

					fileName = frontSlash(fileName);
					targetFileName = fileName.replace(/\-temp$/, "");

					if(this.exists(targetFileName) && targetFileName != fileName) {
						file = cache[targetFileName].clone({contents: false, path: false});
					} else {
						file = new Vinyl({
							stat: {
								isFile: function() {return true},
								isDirectory: function() {return false}
							}
						});
					}

					file.path = fileName;
					file.contents = new Buffer(fileContents);
					cache[fileName] = file;
				},

				deleteFile: function( /*String*/ fileName) {
					//summary: deletes a file or directory if it exists.
					fileName = frontSlash(fileName);
					var i, stat;
					if (this.exists(fileName)) {
						stat = cache[fileName].stat;
						if (stat.isDirectory()) {
							for (i in cache) {
								if (i.indexOf(fileName) > -1) {
									cache[i] = null;
									delete cache[i];
								}
							}
						} else {
							if (hasProp(cache, fileName)) {
								cache[fileName] = null;
								delete cache[fileName];
							}
						}
					}
				},


				/**
				 * Deletes any empty directories under the given directory.
				 */
				deleteEmptyDirs: function(startDir) {
					var i, j, empty, stat;
					for (i in cache) {
						empty = true;
						if (i.indexOf(options.baseUrl) > -1) {
							this.deleteFile(i);
							continue;
						}

						stat = cache[i].stat;

						if (stat.isDirectory()) {
							for (j in cache) {
								if (j.indexOf(i) > -1) {
									empty = false;
									break;
								}
							}

							if (empty) {
								this.deleteFile(i);
							}
						}
					}
				}
			}
		});

		var _this = this;
		console.log("start optimizing ... ");
		requirejs.optimize(options, function(buildResponse) {
			for(var i in cache) {
				_this.push(cache[i])
			}

			callback()
		}, function(err) {
			console.log("[watch]build error: ", err);
		})
	}

	return through.obj(start, end);
};