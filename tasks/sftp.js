/*
 * grunt-ssh
 * https://github.com/andrewrjones/grunt-ssh
 *
 * Copyright (c) 2013 Andrew Jones
 * Licensed under the MIT license.
 */

module.exports = function (grunt) {

    'use strict';

    grunt.util = grunt.util || grunt.utils;

    grunt.registerMultiTask('sftp', 'Copy files to a (remote) machine running an SSH daemon.', function () {

        var utillib = require('./lib/util').init(grunt);
        var async = require('async');
        var Connection = require('ssh2');
        var path = require('path');
        var sftpHelper = require('./lib/sftpHelpers').init(grunt);
        var options = this.options({
            path: '',
            host: false,
            username: false,
            password: false,
            agent: '',
            port: utillib.port,
            minimatch: {},
            srcBasePath: '',
            createDirectories: false,
            directoryPermissions: parseInt(755, 8)
        });

        var symbols = {
          ok: '✓',
          err: '✖'
        };

        // With node.js on Windows: use symbols available in terminal default fonts
        if ('win32' == process.platform) {
          symbols.ok = '\u221A';
          symbols.err = '\u00D7';
        }

        grunt.verbose.writeflags(options, 'Raw Options');

        function setOption (optionName) {
            var option;
            if ((!options[optionName]) && (option = grunt.option(optionName))) {
                options[optionName] = option;
            }
        }

        setOption('config');

        if (options.config && grunt.util._(options.config).isString()) {
            this.requiresConfig(['sshconfig', options.config]);
            var configOptions = grunt.config.get(['sshconfig', options.config]);
            options = grunt.util._.extend(options, configOptions);
        }

        setOption('username');
        setOption('password');
        setOption('passphrase');

        grunt.verbose.writeflags(options, 'Options');

        var files = this.files;
        var connection = new Connection();
        var done = this.async();

        connection.on('connect', function () {
            grunt.verbose.writeln('Connection :: connect');
        });

        connection.on('ready', function () {

            async.eachSeries(files, function (file, callback) {

                var srcFiles = grunt.file.expand(options.minimatch, file.src);

                if (srcFiles.length === 0) {
                    return callback('Unable to copy; no valid source files were found.');
                }

                connection.sftp(function (err, sftp) {

                    if (err) {
                        return callback(err);
                    }

                    sftp.on('end', function () {
                        grunt.verbose.writeln('SFTP :: SFTP session closed');
                    });

                    sftp.on('close', function (had_error) {
                        grunt.verbose.writeln('SFTP :: close');
                        if (had_error) {
                            return callback(had_error);
                        }
                    });

                    // TODO - before we start copying files ensure all
                    // the directories we are copying into will exist, otherwise
                    // the async thingie causes problems
                    var fileQueue = [];
                    var paths = [];

                    srcFiles.forEach(function (srcFile) {

                        if (grunt.file.isDir(srcFile)) {
                            return;
                        }

                        var destFile = options.path;

                        if (srcFile.indexOf(options.srcBasePath) === 0) {
                            destFile += srcFile.replace(options.srcBasePath, '');
                        } else {
                            destFile += srcFile;
                        }

                        fileQueue.push({
                            src: srcFile,
                            dest: destFile
                        });


                        var pathName = path.dirname(destFile);
                        if (paths.indexOf(pathName) === -1) {
                            paths.push(pathName);
                        }
                    });

                    async.eachSeries(paths, function (path, callback) {

                        if (!options.createDirectories) {
                            return callback();
                        }

                        grunt.verbose.writeln('Checking existence of path ' + path);

                        sftpHelper.sftpRecursiveMkDir(sftp, path, {
                            permissions: options.directoryPermissions
                        }, function (result, msg) {

                            if (!result) {
                                callback(msg);
                            } else {
                                callback();
                            }
                        });
                    }, function (err) {

                        if (err) {
                            return callback('Path creation failed: ' + err);
                        }

                        async.eachSeries(fileQueue, function (file, callback) {
                            grunt.verbose.writeln('copying ' + file.src + ' to ' + file.dest);

                            sftp.fastPut(file.src, file.dest, function (err) {

                                if (err) {
                                    // show red dot when `file` failed to upload
                                    // and not in verbose mode.
                                    grunt.verbose.or.write('  ' + symbols.err.red.bold + ' ' + file.src);
                                    return callback(err);
                                }

                                // show green dot when `file` is uploaded
                                // succesfully and not in verbose mode.
                                grunt.verbose.writeln('copied ' + file.src + ' to ' + file.dest).or.writeln('  ' + symbols.ok.green.bold + ' ' + file.src.grey.bold);
                                callback();
                            });

                        }, function (err) {
                            sftp.end();
                            callback(err);
                        });
                    });
                });

            }, function (err) {

                if (err) {
                    grunt.log.error(err);
                }

                connection.end();
            });
        });

        connection.on('error', function (err) {
            grunt.log.error('Connection :: error :: ' + err);
        });

        connection.on('end', function () {
            grunt.verbose.writeln('Connection :: end');
        });

        connection.on('close', function (had_error) {

            if (had_error) {
                grunt.log.error(had_error);
            }

            grunt.verbose.writeln('Connection :: close');
            done();
        });

        var connectionOptions = utillib.parseConnectionOptions(options);
        connection.connect(connectionOptions);
    });
};